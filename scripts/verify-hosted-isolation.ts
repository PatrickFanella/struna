/** #94: built-browser account/anonymous/cache boundary. Offline scratch only. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { testHosted } from "../server/auth/test-server.ts";

const h = await testHosted(), dist = resolve(import.meta.dirname, "../dist");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
try {
 const a = await h.signIn("A"), b = await h.signIn("B");
 for (const [p, name] of [[a,"ALICE_ONLY"],[b,"BOB_ONLY"]] as const) await h.call("/api/profile",p,"PUT",{name});
 const context = await browser.newContext({viewport:{width:390,height:844}});
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
 const page=await context.newPage();
 await page.goto(h.origin);
 await page.getByRole("heading",{name:"Your private practice"}).waitFor();
 assert.ok(!(await page.content()).includes("ALICE_ONLY"));
 assert.equal(await page.evaluate(async()=> (await fetch("/api/today")).status),401);
 const setIdentity=async(p:typeof a)=>context.addCookies([{name:"__Host-struna-session",value:p.cookie.split("=")[1]!,domain:"practice.example",path:"/",secure:true,httpOnly:true,sameSite:"Lax"}]);
 await setIdentity(a);await page.reload();
 await page.getByRole("button",{name:"Edit profile",exact:true}).click();
 assert.equal(await page.getByLabel("Your name").inputValue(),"ALICE_ONLY");
 assert.ok(!(await page.content()).includes("BOB_ONLY"));
 // Cookie switch in another tab: old document's session may not access B's data.
 await setIdentity(b);
 const stale=await page.evaluate(async session=> (await fetch("/api/today",{headers:{"x-struna-session":session}})).status,a.session);
 assert.equal(stale,409);
 await page.evaluate(()=>dispatchEvent(new Event("focus")));
 await page.getByRole("button",{name:"Edit profile",exact:true}).click();
 assert.equal(await page.getByLabel("Your name").inputValue(),"BOB_ONLY");
 assert.ok(!(await page.content()).includes("ALICE_ONLY"));
 await page.getByRole("button",{name:"Sign out",exact:true}).click();
 await page.getByRole("heading",{name:"Your private practice"}).waitFor();
 assert.ok(!(await page.content()).includes("BOB_ONLY"));
 for(const path of ["/api/materials","/api/recordings","/api/conversations","/api/providers"]) assert.equal(await page.evaluate(async path=>(await fetch(path)).status,path),401);
 console.log("#94 built browser: anonymous shell, two accounts, stale cookie/header switch, sign-out and private-route denial passed");
 for (const path of readdirSync(dist,{recursive:true,encoding:"utf8"}).filter(p=>/^(?:assets|brand|starter)\//.test(p)&&/\.(?:js|mjs|css|svg|json|txt)$/.test(p)).concat("manifest.webmanifest")) {
  const response=await page.evaluate(async path=>{const r=await fetch("/"+path);return {status:r.status,text:await r.text()};},path); assert.equal(response.status,200,path);
  const bytes=response.text;
  for(const forbidden of ["ALICE_ONLY","BOB_ONLY","OWNER_FORBIDDEN_CANARY","ALICE_CACHE_CANARY",a.account,b.account])assert.ok(!bytes.includes(forbidden),path);
 }
 await context.close();
} finally {await browser.close();await h.close();}
