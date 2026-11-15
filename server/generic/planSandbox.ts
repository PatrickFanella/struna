import { execFile } from "node:child_process";
import { mkdtemp, mkdir, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export type PlanSandbox = { home: string; candidateDir: string };
/** An outer write boundary. The CLI's credential, read, tool and egress policies still apply inside it. */
export function planSandboxCommand(bin: string, args: string[], sandbox: PlanSandbox): { bin: string; args: string[] } {
  const writable = ["materials", "coach-notes.md", "profile.json", sandbox.candidateDir];
  return { bin: "/usr/bin/bwrap", args: ["--bind", "/", "/", "--unshare-user", "--unshare-pid", "--proc", "/proc", "--die-with-parent", "--cap-drop", "ALL", "--ro-bind", sandbox.home, sandbox.home,
    ...writable.flatMap((p) => ["--bind", join(sandbox.home, p), join(sandbox.home, p)]), "--chdir", sandbox.home, "--", bin, ...args] };
}
const exec = promisify(execFile);
/** Offline: a real installed CLI must launch, and hostile writes under the same wrapper must fail. No model request. */
export async function probePlanSandbox(bin: string): Promise<{ ok: boolean; detail: string }> {
  const root = await mkdtemp(join(tmpdir(), "struna-plan-probe-"));
  try {
    const home = await realpath(root);
    for (const d of ["materials", "plan/archive", ".coach-candidates/probe"]) await mkdir(join(home, d), { recursive: true });
    for (const [path, raw] of [["plan/plan.json", "base"], ["plan/archive/old.json", "archive"], ["coach-notes.md", "notes"], ["profile.json", "{}"], [".coach-candidates/probe/plan.json", "candidate"]]) await writeFile(join(home, path!), raw!);
    const sandbox = { home, candidateDir: ".coach-candidates/probe" };
    const hostile = `const fs=require('node:fs'); const path=require('node:path'); const home=process.cwd();
      const denied=[()=>fs.writeFileSync('plan/plan.json','bad'),()=>fs.unlinkSync('plan/plan.json'),()=>fs.renameSync('plan/plan.json','materials/moved'),()=>fs.renameSync('plan','materials/plan'),()=>fs.symlinkSync('/dev/null','plan/link'),()=>fs.writeFileSync(path.join(home,'plan/archive/old.json'),'bad'),()=>fs.unlinkSync('plan/archive/old.json'),()=>fs.linkSync('plan/plan.json','materials/alias'),()=>fs.writeFileSync('../'+path.basename(home)+'/plan/plan.json','bad')];
      for(const attempt of denied){let blocked=false;try{attempt()}catch{blocked=true}if(!blocked)throw Error('Live plan write escaped sandbox')}
      fs.writeFileSync('.coach-candidates/probe/plan.json','allowed');fs.writeFileSync('materials/probe','allowed');fs.writeFileSync('coach-notes.md','allowed');fs.writeFileSync('profile.json','{}');`;
    const p = planSandboxCommand(process.execPath, ["-e", hostile], sandbox);
    await exec(p.bin, p.args, { cwd: home, timeout: 15000 });
    if (await readFile(join(home, "plan/plan.json"), "utf8") !== "base" || await readFile(join(home, "plan/archive/old.json"), "utf8") !== "archive") throw new Error("Probe bytes changed");
    const cli = planSandboxCommand(bin, ["--version"], sandbox);
    const version = await exec(cli.bin, cli.args, { cwd: home, timeout: 15000 });
    return { ok: true, detail: `Offline plan sandbox probe passed: ${version.stdout.trim().slice(0, 100)}` };
  } catch {
    return { ok: false, detail: "This Coach is disabled: its offline plan-write sandbox probe failed. The operator must qualify Bubblewrap and this CLI before it can run; there is no direct-write fallback." };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function checkPlanSandboxPaths(sandbox: PlanSandbox) {
  const home = await realpath(sandbox.home);
  for (const dir of ["materials", "plan", "plan/archive", sandbox.candidateDir]) {
    if (await realpath(join(home, dir)) !== join(home, dir)) throw new Error("Coach write boundaries must not be symlinks.");
  }
  for (const file of ["coach-notes.md", "profile.json"]) {
    const st = await lstat(join(home, file));
    if (!st.isFile() || st.nlink !== 1) throw new Error("Coach writable files must be regular files without hard links.");
  }
}
