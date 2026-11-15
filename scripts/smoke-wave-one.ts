/** Scratch Studio UI regression. pnpm build; node scripts/smoke-wave-one.ts [--before]. No live data/providers. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { nextStage } from "./practice-steps.ts";
import { normalizeProfile } from "../server/generic/studio.ts";

const before = process.argv.includes("--before");
const landingOnly = process.argv.includes("--landing-only");
const dir = await mkdtemp(join(tmpdir(), "struna-wave-one-"));
const home = join(dir, "home");
const geometry: unknown[] = [];
await mkdir(join(home, "plan"), { recursive:true });
await mkdir(join(home, "materials"));
await writeFile(join(home, "profile.json"), JSON.stringify(normalizeProfile({}, new Date().toISOString())));
await writeFile(join(home, "materials/roll.md"), "# Baseline roll\n\n```\ne|------0---|\nB|----0---0-|\nG|--0-------|\nD|--------0-|\nA|0---------|\nE|----------|\n```\n");
const stages = [
  { key:"tune", title:"Tune up", minutes:2, task:"Tune each string." },
  { key:"technique", title:"Technique", minutes:6, task:"Play two relaxed rolls.", targetBpm:80, material:{ file:"materials/roll.md" } },
  { key:"record", title:"Record a take", minutes:2, task:"Record one complete roll." },
];
const plan = { version:1, id:"wave-one", title:"Scratch practice", started:"2026-01-01", goal:"Build an even roll and play Black Mountain Rag with a relaxed picking hand and a steady pulse over several complete repetitions without losing the melody or rushing the transitions.", next:"Tune each string. Then play two relaxed rolls.", extras:[], phases:[{ title:"Clean notes", summary:"Listen", sessions:6, focus:{} }], materials:[{ label:"Baseline roll", file:"materials/roll.md" }], sessions:[{id:"quick", label:"Quick", stages}, {id:"short", label:"Short", stages:[...stages, {key:"song", title:"Tune practice", minutes:15, task:"Play a tune."}]}, {id:"full", label:"Full", stages:[...stages,{key:"song", title:"Tune practice", minutes:35, task:"Play a tune."}]}] };
await writeFile(join(home, "plan/plan.json"), JSON.stringify(plan));
const socket = createServer();
await new Promise<void>(r=>socket.listen(0,"127.0.0.1",r));
const port = (socket.address() as {port:number}).port;
await new Promise<void>(r=>socket.close(()=>r()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath,["server/index.ts"],{ env:{...process.env,NODE_ENV:"production",STRUNA_MODE:"studio",STRUNA_HOME:home,STRUNA_STATE_DIR:join(dir,"state"),STRUNA_CACHE_DIR:join(dir,"cache"),STRUNA_LIBRARY_DIRS:"",STRUNA_TABS_DIR:"",SOCKET_PATH:"",EDGE_SECRET_FILE:"",REQUIRE_USER:"",STRUNA_NO_SCAN:"1",STRUNA_COACH_HOST_LOGINS:"0",CLAUDE_BIN:"/bin/false",CODEX_BIN:"/bin/false",HOST:"127.0.0.1",PORT:String(port)}, stdio:"ignore" });
const browser = await chromium.launch({executablePath:process.env.CHROMIUM??"/usr/bin/chromium",args:["--no-sandbox"]});
try {
  for(let i=0;;i++) {
    if(child.exitCode!==null) throw Error("Scratch server exited");
    if(await fetch(`${base}/api/health`).then(r=>r.ok,()=>false)) break;
    if(i>100) throw Error("Scratch server did not start");
    await new Promise(r=>setTimeout(r,100));
  }
  const token=(await readFile(join(dir,"state/access-token"),"utf8")).trim();
  for(const [width,height] of [[320,700],[390,844],[844,390],[1153,814],[1003,814],[502,407]]) for(const theme of ["light","dark","device-light","device-dark"]) {
    const context=width===502
      ? await chromium.launchPersistentContext(join(dir, `zoom-${theme}`),{executablePath:process.env.CHROMIUM??"/usr/bin/chromium",args:["--no-sandbox"],viewport:{width:1003,height:814},colorScheme:theme.endsWith("dark")?"dark":"light"})
      : await browser.newContext({viewport:{width:width!,height:height!},colorScheme:theme.endsWith("dark")?"dark":"light"});
    if(width===502) {
      const settings=await context.newPage(); await settings.goto("chrome://settings/appearance");
      await settings.evaluate(async()=>{
        const {chrome}=globalThis as unknown as {chrome:{settingsPrivate:{setDefaultZoom:(n:number)=>Promise<void>}}};
        await chrome.settingsPrivate.setDefaultZoom(2);
      });
      await settings.close();
    }
    const page=await context.newPage();
    const errors:string[]=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(t=>{if(!t.startsWith("device"))localStorage.setItem("struna.theme",t);},theme);
    await page.goto(`${base}/?token=${token}#practice`);
    await page.locator(".gstart").waitFor();
    if(width===502) assert.ok(await page.evaluate(()=>innerWidth===501 && devicePixelRatio===2),"native desktop 200% zoom");
    if(!before) {
      const noSession=await page.evaluate(()=>sessionStorage.getItem("struna.session"));
      const durations=page.getByRole("radiogroup",{name:"Practice duration"});
      await durations.getByRole("radio",{name:/^Full/}).focus();
      await page.keyboard.press("Home");
      await durations.getByRole("radio",{name:/^Quick/}).waitFor();
      assert.equal(await page.getByRole("button",{name:"Start 10 min",exact:true}).count(),1);
      assert.equal(await durations.getByRole("radio",{name:/^Quick/}).evaluate(el=>el===document.activeElement),true,"Home selects and focuses first duration");
      await page.keyboard.press("End");
      assert.equal(await page.getByRole("button",{name:"Start 45 min",exact:true}).count(),1);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem("struna.session")),noSession,"duration choice writes no session");
      assert.equal(await durations.getByRole("radio",{name:/^Full/}).evaluate(el=>el===document.activeElement),true,"End selects and focuses final duration");
      await page.keyboard.press("Home");
      if(width===390) {
        const controls=await page.locator(".duration-options,.start-selected").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}));
        const navTop=await page.locator(".dock .tabs").evaluate(el=>el.getBoundingClientRect().top);
        assert.ok(controls.every(r=>r.top>=0 && r.bottom<=navTop),"durations and Start fit with persistent navigation");
      }
    }
    geometry.push({width,height,theme,controls:await page.locator(".duration-options,.start-selected,.dock .tabs").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {selector:el.className,x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};}))});
    await page.screenshot({path:join(dir,`${width}-${theme}-landing.png`)});
    if(landingOnly) { assert.deepEqual(errors,[]); await context.close(); continue; }
    if (await page.getByRole("radio", {name:/^Quick/}).count()) {
      await page.getByRole("radio", {name:/^Quick/}).click();
      await page.getByRole("button", {name:"Start 10 min", exact:true}).click();
    } else await page.getByRole("button",{name:/^Quick/}).click();
    await page.locator(".session").waitFor();
    if(!before) {
      const summary=page.locator(".session-details summary");
      const timer=page.getByRole("button",{name:"Start the stage timer",exact:true});
      await timer.waitFor();
      const stateBefore=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("struna.session")!));
      await summary.focus(); await page.keyboard.press("Enter");
      await page.getByText("Active practice",{exact:false}).waitFor();
      await page.keyboard.press("Enter");
      assert.equal(await summary.evaluate(el=>el===document.activeElement),true);
      const stateAfter=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("struna.session")!));
      assert.equal(stateAfter.resumedAt,stateBefore.resumedAt);
      assert.equal(stateAfter.stage,stateBefore.stage);
      assert.equal(stateAfter.elapsedBefore,stateBefore.elapsedBefore);
      assert.equal(await page.getByRole("heading",{level:1}).count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const header=await page.locator(".sessiontop").boundingBox();
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:join(dir,`${width}-${theme}-header.png`)});
      assert.ok(header && header.height < (width===320?270:width===390?250:230),`compact header at ${width}: ${header?.height}`);
      await timer.click();
      await page.getByRole("button",{name:"Pause the stage timer",exact:true}).click();
      await page.getByRole("button",{name:"Resume the stage timer",exact:true}).waitFor();
      assert.equal(await page.locator(".stage-tempo").count(),0,"Tune up has no fallback BPM prompt");
      assert.equal(await page.getByRole("button",{name:/Log clean pass/}).count(),0);
      await nextStage(page);
      await page.getByRole("button",{name:/Log clean pass/}).waitFor();
      await page.getByRole("button",{name:"Adjust tempo",exact:true}).click();
      await page.getByLabel("BPM",{exact:true}).fill("91");
      await page.getByLabel("BPM",{exact:true}).press("Enter");
      await page.getByRole("button",{name:"Done",exact:true}).click();
      await page.getByText("Your tempo: 91 BPM",{exact:false}).waitFor();
      await page.getByRole("button",{name:"Tools",exact:true}).click();
      await page.getByRole("button",{name:"Tools",exact:true}).click();
      await page.getByText("Your tempo: 91 BPM",{exact:false}).waitFor();
      await nextStage(page);
      await page.getByRole("button",{name:"Record take",exact:true}).waitFor();
      assert.equal(await page.getByRole("button",{name:/Log clean pass/}).count(),0,"Recording leads with recorder");
      assert.equal(await page.locator(".stage-tempo").count(),0,"Recording has no irrelevant tempo suggestion");
    }
    await page.screenshot({path:join(dir,`${width}-${theme}-stage.png`)});
    assert.deepEqual(errors,[],"no browser runtime errors");
    await context.close();
  }
  await writeFile(join(dir,"geometry.json"),JSON.stringify(geometry,null,2));
  console.log(`PASS ${before?"baseline captures":"compact header and timer matrix"}: ${dir}`);
} finally { await browser.close(); child.kill(); }
