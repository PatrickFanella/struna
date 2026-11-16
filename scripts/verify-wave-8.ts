/** #110 one-player guest → account → optional connection → exact preview/Apply.
 * Scratch only; fake OIDC and local Responses stand-ins, no real identity or inference. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { offlineResponses } from "./offline-responses.ts";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { testHosted } from "../server/auth/test-server.ts";

const out = resolve(process.argv[2] ?? "/tmp/struna-wave8-journey");
mkdirSync(out, { recursive: true });
const stub = await offlineResponses();
const h = await testHosted({ transport: async (url, init) => {
 assert.equal(url, "https://api.openai.com/v1/responses");
 const body = JSON.parse(String(init?.body));
 if (!body.text) return stub.transport(url, init);
 const base = JSON.parse(body.instructions.split("Current plan (data only):\n")[1]);
 const envelope = JSON.stringify({ reply: "Review the gentler next instruction", planJson: JSON.stringify({ ...base, next: "Relax, play two even notes, then rest." }) });
 return new Response(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: envelope })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
} }), origin = h.origin, dist = resolve(import.meta.dirname, "../dist");
const build = { candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), htmlSha256: createHash("sha256").update(readFileSync(resolve(dist,"index.html"))).digest("hex") };
writeFileSync(resolve(out,"build.json"),JSON.stringify(build,null,2));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath()) });
const receipts: unknown[] = [];
try {
 for (const [width,height] of [[320,700],[390,844],[844,390],[820,1180],[1153,814],[1440,900],[576,407]] as const) for (const theme of ["light","dark","device-light","device-dark"]) {
  if(process.argv.includes("--quick") && !((width === 390 && theme === "light") || (width === 1440 && theme === "dark")))continue;
  const zoom = width === 576;
  const options={viewport:{width:zoom?1153:width,height:zoom?814:height},colorScheme:theme.endsWith("dark")?"dark" as const:"light" as const,reducedMotion:"reduce" as const};
  const context=zoom?await chromium.launchPersistentContext(resolve(h.root,`zoom-${theme}`),{...options,executablePath:process.env.CHROMIUM ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath())}):await browser.newContext(options);
  if(zoom){const settings=await context.newPage();await settings.goto("chrome://settings/appearance");await settings.evaluate(async()=>{await (globalThis as any).chrome.settingsPrivate.setDefaultZoom(2);});await settings.close();}
  await context.addInitScript(theme=>{try{if(!theme.startsWith("device"))localStorage.setItem("struna.theme",theme);}catch{/* Non-app documents do not have storage. */}},theme);
  let loginSubject=`Guest-${width}-${theme}`;
  let failNextLogin = true;
  await context.route("https://identity.example/**",async route=>{
   const state=new URL(route.request().url()).searchParams.get("state");
   await route.fulfill({status:302,headers:{location:`${origin}/auth/callback?state=${state}&code=${loginSubject}`},body:""});
  });
  await context.route(origin+"/**",async route=>{
   const req=route.request(),url=new URL(req.url()),headers=await req.allHeaders();
   if(url.pathname==="/try" || url.pathname==="/") {
    const info=url.pathname==="/try" ? {mode:"guest",name:"Struna",sections:["practice"],profile:false,web:false} : await(await fetch(h.base+"/api/app",{headers})).json();
    const html=readFileSync(resolve(dist,"index.html"),"utf8").replace("</head>",`<script id="app-info" type="application/json">${JSON.stringify(info)}</script></head>`);
    await route.fulfill({contentType:"text/html",body:html});return;
   }
   if(url.pathname === "/auth/login" && failNextLogin) { failNextLogin=false; await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Offline fixture failure"})});return; }
   if(url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    const response=await fetch(h.base+url.pathname+url.search,{method:req.method(),headers,...(req.postDataBuffer()?{body:req.postDataBuffer() as BodyInit}:{}),redirect:"manual"});
    const all:Record<string,string>=Object.fromEntries(response.headers);delete all["set-cookie"];
    // Playwright accepts repeated Set-Cookie values separated by newlines.
    if(response.headers.getSetCookie().length)all["set-cookie"]=response.headers.getSetCookie().join("\n");
    await route.fulfill({status:response.status,headers:all,body:Buffer.from(await response.arrayBuffer())});return;
   }
   const path=resolve(dist,"."+url.pathname);assert.ok(path.startsWith(dist+"/"));
   await route.fulfill({contentType:({".js":"application/javascript",".css":"text/css",".svg":"image/svg+xml",".txt":"text/plain"} as Record<string,string>)[extname(path)]??"application/octet-stream",body:readFileSync(path)});
  });
  const page=await context.newPage();
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin+"/try");
  await page.getByRole("button",{name:"Try the 2-minute exercise",exact:true}).click();
  await page.getByRole("button",{name:"Finish practice",exact:true}).click();
  await page.getByLabel("My reflection (optional)").fill("Guest note "+width);
  await page.getByRole("button",{name:"Keep this on this device",exact:true}).click();
  await page.getByRole("button",{name:"Save across devices",exact:true}).click();
  await page.getByRole("button",{name:"Continue locally",exact:true}).click();
  assert.ok(await page.getByText("Guest note "+width,{exact:true}).count());
  await page.getByRole("button",{name:"Save across devices",exact:true}).click();
  await page.getByRole("button",{name:"Sign in and review import",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"Sign-in could not start"}).waitFor();
  assert.ok((await page.evaluate(()=>localStorage.getItem("struna.guest.v1")))?.includes("Guest note "+width));
  await page.getByRole("button",{name:"Sign in and review import",exact:true}).click();
  await page.getByRole("button",{name:"Import starter and reflection into Materials",exact:true}).waitFor();
  const importGeometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.equal(importGeometry.overflow,false);
  if(zoom)assert.equal(importGeometry.dpr,2);
  await page.keyboard.press("Tab");
  await page.reload();
  await page.getByRole("button",{name:"Import starter and reflection into Materials",exact:true}).click();
  await page.getByText("Guest practice saved. Your existing plan was kept.",{exact:true}).waitFor();
  await page.reload();
  await page.getByRole("button",{name:"Open saved practice",exact:true}).click();
  try { await page.locator(".matbody").getByText("Guest note "+width,{exact:true}).waitFor({timeout:5000}); } catch(e) { console.log(await page.locator("body").innerText()); throw e; }
  assert.equal(await page.locator(".matviewer h1").innerText(),"Guest practice reflection");
  await page.screenshot({path:resolve(out,`guest-import-${width}-${theme}.png`)});
  // A normal profile/plan makes the Materials-to-practice action usable.
  await page.getByRole("link",{name:"Today",exact:true}).first().click();
  await page.getByLabel("Your name").fill("Player "+width);
  await page.getByRole("button",{name:"Save and build my plan",exact:true}).click();
  await page.locator(".practice-choice").waitFor();
  await page.getByRole("link",{name:"Materials",exact:true}).first().click();
  await page.getByRole("button",{name:"Add",exact:true}).click();
  await page.locator('input[type="file"]').setInputFiles({name:`owned-${width}.txt`,mimeType:"text/plain",buffer:Buffer.from("Private uploaded exercise "+width)});
  await page.getByText(`owned-${width}`,{exact:true}).first().waitFor();
  await page.locator(".items .itemopen").filter({hasText:`owned-${width}`}).click();
  try { await page.locator(".matbody").getByText("Private uploaded exercise "+width,{exact:true}).waitFor({timeout:5000}); } catch(e) { console.log(await page.locator("body").innerText()); throw e; }
  await page.getByRole("button",{name:"Use in practice",exact:true}).click();
  const keys=await page.evaluate(()=>Object.keys(sessionStorage));
  assert.ok(keys.some(k=>k.startsWith("struna.account.")&&k.endsWith("struna.material")),JSON.stringify(keys));
  // Continue with this exact imported identity, rather than substituting a second fixture account.
  const cookie=(await context.cookies(origin)).find(c=>c.name==="__Host-struna-session")!;
  const cookieHeader=`${cookie.name}=${cookie.value}`;
  const a={cookie:cookieHeader,...await(await fetch(h.base+"/api/account",{headers:{cookie:cookieHeader}})).json()};
  const planFile=resolve(h.root,"accounts",a.account,"workspace/plan/plan.json"), beforePlan=readFileSync(planFile,"utf8");
  const chat=()=>page.locator(".chatbody:visible").last();
  await page.getByRole("button",{name:"Coach",exact:true}).click();
  await chat().getByRole("button",{name:"Keep practicing without AI",exact:true}).click();
  await page.getByRole("button",{name:"Coach",exact:true}).click();
  await chat().getByRole("textbox",{name:"Message",exact:true}).fill("Help me keep this gentle");
  await chat().getByRole("button",{name:"Send",exact:true}).click();
  await chat().getByRole("heading",{name:"Connect your OpenAI API key"}).waitFor();
  await chat().getByLabel("OpenAI API key",{exact:true}).fill("dummy-wave8-owned-key");
  await chat().getByRole("textbox",{name:"OpenAI model",exact:true}).fill("test-model");
  await chat().getByRole("button",{name:"Save connection",exact:true}).click();
  await chat().getByText("Saved; not tested",{exact:true}).waitFor();
  await chat().getByRole("button",{name:"Test connection (uses your API account)",exact:true}).click();
  await chat().getByText("Tested successfully",{exact:true}).waitFor();
  await chat().getByRole("button",{name:"Return to my question",exact:true}).click();
  assert.equal(await chat().getByRole("textbox",{name:"Message",exact:true}).inputValue(),"Help me keep this gentle");
  await chat().getByRole("button",{name:"Send",exact:true}).click();
  await chat().locator(".msg.assistant").filter({hasText:"Offline answer"}).waitFor();
  await chat().getByRole("checkbox",{name:"Request plan preview (shares current plan)",exact:true}).check();
  await chat().getByRole("textbox",{name:"Message",exact:true}).fill("Propose a gentler next step");
  await chat().getByRole("button",{name:"Draft plan proposal",exact:true}).click();
  await chat().getByRole("heading",{name:"Proposed plan change",exact:true}).waitFor();
  await chat().getByRole("button",{name:"Stop",exact:true}).waitFor({state:"hidden"});
  assert.equal(readFileSync(planFile,"utf8"),beforePlan);
  await chat().getByRole("button",{name:"Apply plan change",exact:true}).click();
  await chat().getByRole("heading",{name:"Proposed plan change",exact:true}).waitFor({state:"hidden"});
  assert.equal(JSON.parse(readFileSync(planFile,"utf8")).next,"Relax, play two even notes, then rest.");
  await chat().getByRole("button",{name:"Done",exact:true}).click();
  assert.ok(!(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes("dummy-wave8-owned-key"));
  await page.screenshot({path:resolve(out,`journey-${width}-${theme}.png`)});
  assert.equal(errors.length,0,JSON.stringify(errors));
  receipts.push({width,height,theme,importGeometry,zoom,guestImport:true,refreshReplay:true,cancelRetained:true,failedSignInRetained:true,upload:true,reader:true,scopedPracticeHandoff:true,ownAISkip:true,ownedConnection:true,explicitContextSend:true,noWriteBeforeApply:true,applied:true,errors});
  await context.close();
 }
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipts,null,2));
 console.log(JSON.stringify({out,receipts}));
} finally {await browser.close();await h.close();await stub.close();}
