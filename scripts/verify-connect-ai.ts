/** #97 optional hosted connection: built UI and local HTTP provider only. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { testHosted } from "../server/auth/test-server.ts";
import { offlineResponses } from "./offline-responses.ts";

const out=resolve(process.argv[2]??"/tmp/struna-connect-ai");mkdirSync(out,{recursive:true});
const stub=await offlineResponses(),h=await testHosted({transport:stub.transport}),dist=resolve(import.meta.dirname,"../dist");
const executablePath=process.env.CHROMIUM??(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":chromium.executablePath());
const browser=await chromium.launch({executablePath});const receipts:unknown[]=[];
try {
 for(const [width,height] of [[320,700],[390,844],[844,390],[820,1180],[1153,814],[1440,900],[576,407]] as const) for(const theme of ["light","dark","device-light","device-dark"]) {
  if(process.argv.includes("--quick")&&!((width===390&&theme==="light")||(width===1440&&theme==="dark")))continue;
  const zoom=width===576,options={viewport:{width:zoom?1153:width,height:zoom?814:height},colorScheme:theme.endsWith("dark")?"dark" as const:"light" as const,reducedMotion:"reduce" as const};
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
 await page.getByRole("button",{name:"Coach",exact:true}).click();
 await page.getByRole("button",{name:"Keep practicing without AI",exact:true}).click();
 await page.getByRole("button",{name:"Coach",exact:true}).click();
 const question="How can I relax my picking hand?";
 await page.getByRole("textbox",{name:"Message",exact:true}).fill(question);
 const before=stub.requests.length;
 await page.getByRole("button",{name:"Send",exact:true}).click();
 await page.getByRole("heading",{name:"Connect your OpenAI API key"}).waitFor();
 assert.equal(stub.requests.length,before);
 const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1,formOverflow:[...document.querySelectorAll(".chatsettings")].some(el=>el.scrollWidth>el.clientWidth+1)}));
 assert.equal(geometry.overflow,false);assert.equal(geometry.formOverflow,false);if(zoom)assert.equal(geometry.dpr,2);
 await page.getByLabel("OpenAI API key",{exact:true}).fill("dummy-browser-player-key");
 await page.getByRole("textbox",{name:"OpenAI model",exact:true}).fill("fail-401");
 await page.getByRole("button",{name:"Save connection",exact:true}).click();
 await page.getByText("Saved; not tested",{exact:true}).waitFor();
 assert.equal(stub.requests.length,before);
 assert.equal(await page.locator('input[type="password"]').inputValue(),"");
 await page.getByRole("button",{name:"Test connection (uses your API account)",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"OpenAI refused this key"}).waitFor();
 await page.getByRole("textbox",{name:"OpenAI model",exact:true}).fill("test-model");
 await page.getByRole("button",{name:"Save connection",exact:true}).click();
 await page.getByText("Saved; not tested",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Test connection (uses your API account)",exact:true}).click();
 await page.getByText("Tested successfully",{exact:true}).waitFor();
 // Revalidation can invalidate a previously ready key; both settings and Coach must notice.
 stub.rejectNext(401);
 await page.getByRole("button",{name:"Test connection (uses your API account)",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"OpenAI refused this key"}).waitFor();
 await page.getByText("Saved; not tested",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Return to my question",exact:true}).count(),0);
 await page.getByRole("button",{name:"Back to the conversation",exact:true}).click();
 assert.equal(await page.getByRole("textbox",{name:"Message",exact:true}).inputValue(),question);
 const afterFailedRetest=stub.requests.length;
 await page.getByRole("button",{name:"Send",exact:true}).click();
 await page.getByRole("heading",{name:"Connect your OpenAI API key"}).waitFor();
 assert.equal(stub.requests.length,afterFailedRetest,"failed retest must return to setup without sending");
 await page.getByRole("button",{name:"Test connection (uses your API account)",exact:true}).click();
 await page.getByText("Tested successfully",{exact:true}).waitFor();
 const status=await(await h.call("/api/providers",a)).text();assert.ok(!status.includes("dummy-browser-player-key"));
 assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes("dummy-browser-player-key"));
 await page.keyboard.press("Tab");
 await page.screenshot({path:resolve(out,`connection-${width}-${theme}.png`)});
 await page.getByRole("button",{name:"Return to my question",exact:true}).click();
 assert.equal(await page.getByRole("textbox",{name:"Message",exact:true}).inputValue(),question);
 const beforeSend=stub.requests.length;
 await page.getByRole("button",{name:"Send",exact:true}).click();
 await page.locator(".msg.assistant").filter({hasText:"Offline answer"}).waitFor();
 assert.equal(stub.requests.length,beforeSend+1);
 assert.equal(stub.requests.at(-1)!.body.input.at(-1).content,question);
 await page.getByRole("button",{name:"Connect your AI",exact:true}).click();
 await page.getByRole("button",{name:"Disconnect",exact:true}).click();
 await page.getByText("Connect your OpenAI API key",{exact:true}).last().waitFor();
 assert.equal((await(await h.call("/api/providers/openai",a)).json()).connected,false);
 assert.equal(errors.length,0,JSON.stringify(errors));
 receipts.push({width,height,theme,zoom,geometry,skip:true,savedNotTested:true,invalidRecovery:true,failedRetestRefresh:true,tested:true,draftReturn:true,explicitSend:true,disconnect:true,redacted:true});
 await context.close();
 }
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipts,null,2));console.log(JSON.stringify({out,cases:receipts.length}));
} finally {await browser.close();await h.close();await stub.close();}
