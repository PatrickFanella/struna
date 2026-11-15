import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readGuest, guestExercise } from "../../shared/guest.ts";
import { readPlan, readProfile, type Studio } from "../generic/studio.ts";
import { HttpError, readJson, send, type route } from "../http.ts";
import { fileId, srcOf } from "../generic/materials.ts";
import { planLock } from "../generic/planCandidates.ts";
import type { PracticeIdentity } from "./practice.ts";

export function guestImportRoutes(s: Studio, identity: PracticeIdentity, register: typeof route) {
 s.db.exec("CREATE TABLE IF NOT EXISTS guest_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL, receipt TEXT NOT NULL)");
 const snapshot = async () => {
   const [profile, plan] = await Promise.all([readProfile(s),readPlan(s)]);
   return { existing: Boolean(profile || plan.plan || plan.errors.length), revision: createHash("sha256").update(JSON.stringify({profile,plan})).digest("hex") };
 };
 register("GET", "/api/guest-import", async (_req,res,{url}) => {
   const row = s.db.prepare("SELECT receipt FROM guest_imports WHERE id=?").get(url.searchParams.get("id") ?? "") as {receipt:string}|undefined;
   send(res,200,{...await snapshot(),receipt:row ? JSON.parse(row.receipt) : null, account:identity.account});
 });
 register("POST", "/api/guest-import", async (req,res) => {
   const body = await readJson(req), state = readGuest(JSON.stringify(body.state));
   if (!state || !body.state || state.step !== "done" || typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id) || !["save","coach"].includes(body.action) || !["note","starter"].includes(body.choice)) throw new HttpError(400,"Complete the guest exercise and choose what to save");
   const digest = createHash("sha256").update(JSON.stringify({state,action:body.action,choice:body.choice})).digest("hex");
   await planLock(s.home,async()=>{
     const old = s.db.prepare("SELECT digest,receipt FROM guest_imports WHERE id=?").get(body.id) as {digest:string;receipt:string}|undefined;
     if(old) { if(old.digest!==digest)throw new HttpError(409,"This handoff was already saved with different choices");send(res,200,{...JSON.parse(old.receipt),replayed:true});return; }
     const current = await snapshot();
     if(body.revision!==current.revision)throw new HttpError(409,"Your account work changed. Review the import again.");
     identity.assertActive?.();
     const exercise = guestExercise(state), name = `guest-${body.id}/Guest practice reflection.md`;
     const text = `# Guest practice reflection\n\nFocus: ${state.focus}\nExperience: ${state.experience}\nActivity: ${state.mode === "explore" ? "Explored without a guitar" : "Player-reported practice"}\n\n${state.reflection || "No reflection added."}\n\n${body.choice === "starter" ? `## ${exercise.title}\n\n${exercise.instruction}\n\n~~~text\n${exercise.music}\n~~~\n` : ""}\nThis is a player report, not measured improvement.\n`;
     const file=join(s.home,"materials",name);mkdirSync(dirname(file),{recursive:true,mode:0o700});
     try {writeFileSync(file,text,{flag:"wx",mode:0o600});} catch(e) {
       if((e as NodeJS.ErrnoException).code!=="EEXIST" || readFileSync(file,"utf8")!==text)throw new HttpError(409,"The saved guest material conflicts. Keep it and start a new handoff.");
     }
     const receipt={id:body.id,account:identity.account,action:body.action,choice:body.choice,note:state.reflection,materialId:fileId(name),src:srcOf(fileId(name)),destination:body.action==="coach" ? "#coach" : "#materials",planKept:true};
     s.db.prepare("INSERT INTO guest_imports VALUES(?,?,?)").run(body.id,digest,JSON.stringify(receipt));
     send(res,200,receipt);
   });
 });
}
