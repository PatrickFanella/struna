/** #105 deletion UI against scratch accounts; no live data or inference. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { testHosted } from "../server/auth/test-server.ts";
import { offlineResponses } from "./offline-responses.ts";

const out=resolve(process.argv[2]??"/tmp/struna-delete-account");mkdirSync(out,{recursive:true});
const stub=await offlineResponses(),h=await testHosted({transport:stub.transport}),dist=resolve(import.meta.dirname,"../dist");
const executablePath=process.env.CHROMIUM??(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":chromium.executablePath());
const browser=await chromium.launch({executablePath});const receipts:unknown[]=[];
try {
 for(const [width,height] of [[320,700],[390,844],[844,390],[820,1180],[1153,814],[1440,900]] as const) for(const theme of ["light","dark","device-light","device-dark"]) {
  const zoom=false,options={viewport:{width:zoom?1153:width,height:zoom?814:height},colorScheme:theme.endsWith("dark")?"dark" as const:"light" as const,reducedMotion:"reduce" as const};
  const context=zoom?await chromium.launchPersistentContext(resolve(h.root,`zoom-${theme}`),{...options,executablePath}):await browser.newContext(options);
  if(zoom){const settings=await context.newPage();await settings.goto("chrome://settings/appearance");await settings.evaluate(async()=>{await (globalThis as any).chrome.settingsPrivate.setDefaultZoom(2);});await settings.close();}
  await context.addInitScript(theme=>{try{if(!theme.startsWith("device"))localStorage.setItem("struna.theme",theme);}catch{}},theme);
  const a=await h.signIn(`Player-${width}-${theme}`);
  await h.call("/api/profile",a,"PUT",{name:"Connection player"});
  await context.addCookies([{name:"__Host-struna-session",value:a.cookie.split("=")[1]!,domain:"practice.example",path:"/",secure:true,httpOnly:true,sameSite:"Lax"}]);
 await context.route(h.origin+"/**",async route=>{
  const req=route.request(),url=new URL(req.url()),headers=await req.allHeaders();
  if(url.pathname==="/") {
   const info=await(await fetch(h.base+"/api/app",{headers})).json();
   await route.fulfill({contentType:"text/html",headers:{"cache-control":"no-store"},body:readFileSync(resolve(dist,"index.html"),"utf8").replace("</head>",`<script id="app-info" type="application/json">${JSON.stringify(info)}</script></head>`)});return;
  }
  if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/auth/")) {
   const response=await fetch(h.base+url.pathname+url.search,{method:req.method(),headers,...(req.postDataBuffer()?{body:req.postDataBuffer() as BodyInit}:{}),redirect:"manual"});
   const all=Object.fromEntries(response.headers);delete all["set-cookie"];
   if(response.headers.getSetCookie().length)all["set-cookie"]=response.headers.getSetCookie().join("\n");
   await route.fulfill({status:response.status,headers:all,body:Buffer.from(await response.arrayBuffer())});return;
  }
  const path=resolve(dist,"."+url.pathname);assert.ok(path.startsWith(dist+"/"));
  await route.fulfill({contentType:({".js":"application/javascript",".css":"text/css",".svg":"image/svg+xml"} as Record<string,string>)[extname(path)]??"application/octet-stream",body:readFileSync(path)});
 });
 const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(h.origin);
 await page.getByRole("button",{name:"Delete account…",exact:true}).click();
 await page.getByRole("region",{name:"Delete your account"}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Permanently delete my account",exact:true}).isDisabled(),true);
 await page.getByRole("button",{name:"Cancel deletion",exact:true}).click();
 assert.equal((await h.call("/api/today",a)).status,200);
 await page.getByText("Your practice data",{exact:true}).click();
 const pending=page.waitForEvent("download");await page.getByRole("button",{name:"Export practice data",exact:true}).click();
 const download=await pending;assert.equal(JSON.parse(readFileSync((await download.path())!,"utf8")).data.profile.name,"Connection player");
 await page.getByRole("button",{name:"Delete account…",exact:true}).click();
 await page.getByLabel("Type DELETE to confirm").fill("DELETE");
 let blocked=true;
 await page.route("**/auth/delete-account",async route=>{if(blocked)await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Deletion unavailable. Retry."})});else await route.fallback();});
 await page.getByRole("button",{name:"Permanently delete my account",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Deletion unavailable"}).waitFor();
 const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}));
 assert.equal(geometry.overflow,false);assert.deepEqual(errors,[]);
 receipts.push({theme,...geometry,download:download.suggestedFilename(),failureRetry:true});
 await page.screenshot({path:resolve(out,`${width}-${height}-${theme}.png`)});
 blocked=false;
 await page.getByRole("button",{name:"Permanently delete my account",exact:true}).click();
 await page.waitForURL("**/?account=deleted");
 await page.getByRole("status").filter({hasText:"account was deleted"}).waitFor();
 assert.equal((await h.call("/api/today",a)).status,401);
 await context.close();
 }
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipts,null,2));
 console.log(`Deletion UI: ${receipts.length} cases passed`);
} finally {await browser.close();await h.close();await stub.close();}
