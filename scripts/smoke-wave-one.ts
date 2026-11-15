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
const dir = await mkdtemp(join(tmpdir(), "struna-wave-one-"));
const home = join(dir, "home");
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
  for(const [width,height] of [[320,700],[390,844],[844,390],[1153,814],[1003,814]]) for(const theme of ["light","dark","device"]) {
    const context=await browser.newContext({viewport:{width:width!,height:height!},colorScheme:theme==="dark"?"dark":"light"});
    const page=await context.newPage();
    await page.addInitScript(t=>{if(t!=="device")localStorage.setItem("struna.theme",t);},theme);
    await page.goto(`${base}/?token=${token}#practice`);
    await page.locator(".gstart").waitFor();
    await page.screenshot({path:join(dir,`${width}-${theme}-landing.png`)});
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
    await context.close();
  }
  console.log(`PASS ${before?"baseline captures":"compact header and timer matrix"}: ${dir}`);
} finally { await browser.close(); child.kill(); }
