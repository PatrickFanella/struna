/** #108 hosted exact-preview/Apply UI, scratch accounts and offline provider only. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { testHosted } from "../server/auth/test-server.ts";
import { offlineResponses } from "./offline-responses.ts";

const out=resolve(process.argv[2]??"/tmp/struna-plan-apply");mkdirSync(out,{recursive:true});
const stub=await offlineResponses(1500),h=await testHosted({transport:stub.transport,run:async function*({planBase}){yield JSON.stringify({reply:"Review this proposed practice adjustment",planJson:JSON.stringify({...JSON.parse(planBase!),next:"Gentle open strings, then rest"})});}}),dist=resolve(import.meta.dirname,"../dist");
const executablePath=process.env.CHROMIUM??(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":chromium.executablePath());
const browser=await chromium.launch({executablePath});const receipts:unknown[]=[];
try {
 for(const [width,height] of [[320,700],[390,844],[844,390],[820,1180],[1153,814],[1440,900],[576,407]] as const) for(const theme of ["light","dark","device-light","device-dark"]) {
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
 const planFile=resolve(home,"plan/plan.json"), beforePlan=readFileSync(planFile,"utf8");
 await open();
 const propose=async()=>{
  await chat().getByRole("checkbox",{name:"Request plan preview (shares current plan)",exact:true}).check();
  await chat().getByRole("textbox",{name:"Message",exact:true}).fill("Please propose a gentler next instruction");
  await chat().getByRole("button",{name:"Draft plan proposal",exact:true}).click();
  await chat().getByRole("heading",{name:"Proposed plan change",exact:true}).waitFor();
  await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
 };
 await propose();
 assert.equal(readFileSync(planFile,"utf8"),beforePlan);
 await chat().getByText("Complete plan JSON",{exact:true}).click();
 assert.ok((await chat().locator(".plan-proposal").innerText()).includes("Gentle open strings, then rest"));
 if(width===390 && theme==="light") { await chat().locator(".plan-proposal").scrollIntoViewIfNeeded(); await page.screenshot({path:resolve(out,"390-light-preview.png")}); }
 await chat().getByRole("button",{name:"Done",exact:true}).click();await open();
 await h.call("/api/practice-state",a,"PUT",{client:"other-tab",active:true});
 await page.evaluate(()=>dispatchEvent(new Event("struna:practice-state")));
 const apply=()=>chat().getByRole("button",{name:"Apply plan change",exact:true});
 await apply().waitFor();await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>(".chatbody .plan-proposal .primary")?.disabled);
 assert.equal(await apply().isDisabled(),true);
 await h.call("/api/practice-state",a,"PUT",{client:"other-tab",active:false});await page.evaluate(()=>dispatchEvent(new Event("struna:practice-state")));
 await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>(".chatbody .plan-proposal .primary")?.disabled===false);
 let failApply=true;
 await page.route("**/api/plan-candidates/*/apply",async route=>{if(failApply){failApply=false;await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:"Plan preview changed. Reload before Apply."})});}else await route.fallback();});
 await apply().click();await chat().getByRole("alert").filter({hasText:"Plan preview changed"}).waitFor();
 assert.equal(readFileSync(planFile,"utf8"),beforePlan);
 await chat().getByRole("button",{name:"Reload previews",exact:true}).click();
 await apply().click();await chat().getByRole("heading",{name:"Proposed plan change",exact:true}).waitFor({state:"hidden"});
 assert.equal(JSON.parse(readFileSync(planFile,"utf8")).next,"Gentle open strings, then rest");
 // Restore only this scratch fixture for a second suggestion, then dismiss it.
 writeFileSync(planFile,beforePlan);
 await propose();await chat().getByRole("button",{name:"Dismiss proposal",exact:true}).click();
 await chat().getByRole("heading",{name:"Proposed plan change",exact:true}).waitFor({state:"hidden"});
 assert.equal(readFileSync(planFile,"utf8"),beforePlan);
 const geometry=await chat().evaluate(el=>{const r=el.querySelector(".composer")!.getBoundingClientRect();return{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1,composer:r.toJSON()};});
 assert.equal(geometry.overflow,false);assert.ok(geometry.composer.bottom<=geometry.height+1);assert.ok(geometry.composer.top>=0);if(zoom)assert.equal(geometry.dpr,2);
 await page.screenshot({path:resolve(out,`${width}-${height}-${theme}.png`)});
 assert.deepEqual(errors,[]);receipts.push({width,height,theme,geometry,exactPreview:true,noWriteBeforeApply:true,practiceConflict:true,failureRetry:true,applied:true,dismissed:true});
 await context.close();
 }
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipts,null,2));
 console.log(`Plan Apply UI: ${receipts.length} cases passed`);
} finally {await browser.close();await h.close();await stub.close();}
