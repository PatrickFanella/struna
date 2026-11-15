/** #97 optional hosted connection: built UI and local HTTP provider only. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { testHosted } from "../server/auth/test-server.ts";
import { offlineResponses } from "./offline-responses.ts";

const out=resolve(process.argv[2]??"/tmp/struna-connect-ai");mkdirSync(out,{recursive:true});
const stub=await offlineResponses(1500),h=await testHosted({transport:stub.transport}),dist=resolve(import.meta.dirname,"../dist");
const executablePath=process.env.CHROMIUM??(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":chromium.executablePath());
const browser=await chromium.launch({executablePath});const receipts:unknown[]=[];
try {
 for(const [width,height] of [[320,700],[390,844],[844,390],[820,1180],[1153,814],[1440,900],[576,407]] as const) for(const theme of ["light","dark","device-light","device-dark"]) {
  if(process.argv.includes("--zoom")&&width!==576)continue;
  if(process.argv.includes("--quick")&&!((width===390&&theme==="light")||(width===1440&&theme==="dark")||(width===844&&theme==="dark")))continue;
  const zoom=width===576,options={viewport:{width:zoom?1153:width,height:zoom?814:height},colorScheme:theme.endsWith("dark")?"dark" as const:"light" as const,reducedMotion:"reduce" as const};
  const context=zoom?await chromium.launchPersistentContext(resolve(h.root,`zoom-${theme}`),{...options,executablePath}):await browser.newContext(options);
  if(zoom){const settings=await context.newPage();await settings.goto("chrome://settings/appearance");await settings.evaluate(async()=>{await (globalThis as any).chrome.settingsPrivate.setDefaultZoom(2);});await settings.close();}
  await context.addInitScript(theme=>{try{if(!theme.startsWith("device"))localStorage.setItem("struna.theme",theme);}catch{}},theme);
  const a=await h.signIn(`Player-${width}-${theme}`);
  await h.call("/api/profile",a,"PUT",{name:"Context player"});
  const home=resolve(h.root,"accounts",a.account,"workspace");
  const plan=JSON.parse(readFileSync(resolve(home,"plan/plan.json"),"utf8"));
  plan.title="Private context plan";
  plan.sessions=[{id:"reading",label:"Read and play",stages:[{key:"technique",title:"Play open strings",minutes:2,task:"Let the notes ring",targetBpm:60,material:{file:"materials/open-strings.md"}},{key:"music",title:"Play a phrase",minutes:2,task:"Play gently",targetBpm:70,material:{file:"materials/open-strings.md"}}]}];
  plan.phases.forEach((p:any)=>{p.focus={technique:"PHASE_OPEN_STRING_EXERCISE",music:"PHASE_PHRASE_EXERCISE"};});
  plan.next="FIRST_STAGE_NEXT_INSTRUCTION";
  plan.materials=[{label:"Open strings",file:"materials/open-strings.md"}];
  writeFileSync(resolve(home,"plan/plan.json"),JSON.stringify(plan));
  writeFileSync(resolve(home,"materials/open-strings.md"),"Original scratch passage. CONTENT_NOT_SENT");
  await h.call("/api/prompts/custom",a,"PUT",{prompts:[{label:"Reflect with me",text:"Help me interpret my practice"}]});
  await h.call("/api/providers/openai",a,"PUT",{key:"dummy-context-player-key",model:"slow-model"});
  await h.call("/api/providers/openai/test",a,"POST",{confirm:true});
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
 const chat=()=>page.locator(".chatbody:visible").last();
 const open=async()=>{await page.getByRole("button",{name:"Coach",exact:true}).click();await chat().locator(".coach-context").filter({hasText:"Private context plan"}).waitFor();};
 const send=async(text:string)=>{await chat().getByRole("textbox",{name:"Message",exact:true}).fill(text);await chat().getByRole("button",{name:"Send",exact:true}).click();await chat().getByRole("button",{name:"Stop",exact:true}).waitFor();};
 const before=stub.requests.length;
 let failContext=true, blockedContextRequests=0;
 await page.route("**/api/chat/context",async route=>{if(failContext){blockedContextRequests++;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Context preview unavailable. Retry."})});}else await route.fallback();});
 await page.getByRole("button",{name:"Coach",exact:true}).click();
 await chat().getByText("Context preview unavailable. Retry.",{exact:true}).waitFor();
 await chat().getByRole("textbox",{name:"Message",exact:true}).fill("Keep while context retries");
 assert.equal(await chat().getByRole("button",{name:"Send",exact:true}).isDisabled(),true);
 // A Today refresh replaces its equivalent selection while Coach remains open.
 const repeatedFailure=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/chat/context"&&r.status()===503);
 await page.evaluate(()=>dispatchEvent(new CustomEvent("struna:changed",{detail:{plan:true}})));
 await repeatedFailure;
 await chat().getByText("Context preview unavailable. Retry.",{exact:true}).waitFor();
 assert.ok(blockedContextRequests>=2,"the outage must survive another context request");
 assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Keep while context retries");
 assert.equal(await chat().getByRole("button",{name:"Send",exact:true}).isDisabled(),true);
 // Keep the outage active through equivalent selection rerenders; only deliberate Retry restores it.
 failContext=false;
 await chat().getByRole("button",{name:"Retry practice context",exact:true}).click();
 await chat().locator(".coach-context").filter({hasText:"Private context plan"}).waitFor();
 assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Keep while context retries");
 assert.ok((await chat().locator(".coach-context").innerText()).includes("From: Today"));
 assert.ok(await chat().locator(".promptchips button:not(.morechip)").count()<=2);
 await chat().getByRole("button",{name:"More",exact:true}).click();
 await chat().getByRole("button",{name:/Reflect with me/}).click();
 assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Help me interpret my practice");
 assert.equal(stub.requests.length,before,"Draft never calls provider");
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await open();assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Help me interpret my practice");
 await send("Today question");
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await page.getByRole("button",{name:"Start 4 min practice",exact:true}).click();
 await open();
 await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
 assert.equal(stub.requests.length,before+1);
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await page.getByRole("button",{name:/Log clean pass/}).first().click();
 await open();
 await chat().locator(".coach-context").filter({hasText:"Player-confirmed clean tempo: 60 BPM"}).waitFor();
 await send("Playing question");
 if(width>=1000&&!zoom){
  await chat().getByRole("button",{name:"Pin beside music",exact:true}).click();
  await page.getByRole("button",{name:"Unpin Coach",exact:true}).click();
  await open();
 }
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await page.getByRole("button",{name:/^Next stage/}).press("Enter");await page.getByRole("button",{name:"Skip break",exact:true}).press("Enter");
 await page.locator("a[href='#materials']:visible").first().click();
 await open();await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
 assert.equal(stub.requests.length,before+2,"stage, pin and navigation do not duplicate replies");
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await page.locator("a[href='#practice']:visible").first().click();
 await page.getByRole("button",{name:/^Finish/}).click();
 await page.getByText("Optional notes",{exact:true}).click();
 await page.getByRole("textbox",{name:"What was hard",exact:true}).fill("My picking felt tense");
 const reviewBpm=page.getByRole("textbox",{name:"Open strings clean BPM (optional)",exact:true});
 await reviewBpm.fill("54");
 await open();await chat().locator(".coach-context").filter({hasText:"My picking felt tense"}).waitFor();
 await chat().locator(".coach-context").filter({hasText:"Player-confirmed clean tempo: 54 BPM"}).waitFor();
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await reviewBpm.fill("");await open();
 await chat().locator(".coach-context").filter({hasText:"Player-confirmed clean tempo: unmeasured"}).waitFor();
 await send("Cleared review tempo");await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
 assert.match(stub.requests.at(-1)!.body.input.at(-1).content,/Player-confirmed clean tempo: unmeasured/);
 await chat().getByRole("button",{name:"Done",exact:true}).click();
 await reviewBpm.fill("54");await open();
 await chat().locator(".coach-context").filter({hasText:"Player-confirmed clean tempo: 54 BPM"}).waitFor();
 stub.rejectNext(500);await send("Review question");
 await chat().getByRole("textbox",{name:"Message",exact:true}).waitFor();
 await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
 assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Review question");
 const sent=stub.requests.slice(before).map(r=>r.body.input.at(-1).content);
 assert.match(sent[0],/From: Today/);assert.match(sent[1],/Stage: Play open strings/);assert.match(sent[1],/Player-confirmed clean tempo: 60 BPM/);assert.match(sent[1],/PHASE_OPEN_STRING_EXERCISE/);assert.match(sent[1],/FIRST_STAGE_NEXT_INSTRUCTION/);assert.match(sent[3],/From: Review/);assert.match(sent[3],/My picking felt tense/);assert.match(sent[3],/Player-confirmed clean tempo: 54 BPM/);assert.match(sent[3],/PHASE_PHRASE_EXERCISE/);
 assert.ok(!JSON.stringify(sent).includes("CONTENT_NOT_SENT"));
 const geometry=await chat().evaluate(el=>{const r=el.querySelector(".composer")!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1,composer:r.toJSON()};});
 assert.equal(geometry.overflow,false);assert.ok(geometry.composer.bottom<=geometry.height+1);assert.ok(geometry.composer.top>=0);if(zoom)assert.equal(geometry.dpr,2);
 await page.screenshot({path:resolve(out,`${width}-${height}-${theme}.png`)});
 // A stale document may not keep a reply or use B's cookie to send A's draft.
 await send("Cancel on account switch");
 const b=await h.signIn(`Other-${width}-${theme}`,a);
 await context.addCookies([{name:"__Host-struna-session",value:b.cookie.split("=")[1]!,domain:"practice.example",path:"/",secure:true,httpOnly:true,sameSite:"Lax"}]);
 // Session invalidation may already be navigating when the explicit focus event runs.
 // Accept only that navigation race; the new-account bootstrap and empty-state checks below stay mandatory.
 await page.evaluate(()=>dispatchEvent(new Event("focus"))).catch(e=>{if(!String(e.message).includes("Execution context was destroyed"))throw e;});
 await page.waitForFunction(account=>JSON.parse(document.getElementById("app-info")?.textContent??"{}").account===account,b.account);
 assert.equal(await page.locator(".msg").count(),0);
 assert.equal(await page.getByText("Review question",{exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log(`Context case ${width} ${theme} passed`);receipts.push({width,height,theme,geometry,requests:sent.length,from:["Today","Playing","Review"],draftAndFailureRetained:true});
 await context.close();
 }
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipts,null,2));
 console.log(`Context Coach UI: ${receipts.length} cases passed`);
} finally {await browser.close();await h.close();await stub.close();}
