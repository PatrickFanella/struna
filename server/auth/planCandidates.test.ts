import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, readdirSync, linkSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { testHosted } from "./test-server.ts";
import { openDb } from "../db.ts";
import { offlineResponses } from "../../scripts/offline-responses.ts";

test("hosted proposals share account/conversation/lease ownership, preview exact bytes, and reject stale/foreign authority", async () => {
  const h = await testHosted({ run: async function* ({ message, planBase, signal }) {
    if (message === "slow") { yield "{"; await new Promise<void>(r => signal.addEventListener("abort", () => r(), { once: true })); }
    if (planBase === undefined) { yield "Advice only"; return; }
    if (message === "bad") { yield JSON.stringify({ reply: "bad", planJson: JSON.stringify({ file: "../../owner/plan.json" }) }); return; }
    yield JSON.stringify({ reply: "Review this proposal", planJson: JSON.stringify({ ...JSON.parse(planBase!), ...(message === "replace" ? { id: "replacement" } : {}), next: message }) });
  } });
  try {
    const a = await h.signIn("A"), b = await h.signIn("B");
    for (const p of [a,b]) await h.call("/api/profile", p, "PUT", { name: p === a ? "ALICE" : "BOB" });
    const planFile = (p: typeof a) => join(h.root, "accounts", p.account, "workspace/plan/plan.json");
    const before = readFileSync(planFile(a), "utf8"), foreign = readFileSync(planFile(b), "utf8");
    writeFileSync(join(h.root, "owner-plan.json"), "OWNER_FORBIDDEN");
    const propose = async (message: string, extra = {}) => (await h.call("/api/chat", a, "POST", { provider: "openai", message, proposePlan: true, ...extra })).text();
    const snapshot = async (p = a) => (await h.call("/api/plan-candidates", p)).json();
    const apply = (proposal: any, revision: number, p = a, extra = {}) => h.call(`/api/plan-candidates/${proposal.id}/apply`, p, "POST", { digest: proposal.digest, revision, active: false, ...extra });
    await (await h.call("/api/chat",a,"POST",{provider:"openai",message:"advice"})).text();
    assert.equal((await snapshot()).proposals.length, 0);
    assert.match(await propose("Slow down"), /Plan preview ready/);
    let snap = await snapshot(), p = snap.proposals[0];
    assert.equal(p.beforeJson, before); assert.equal(p.after.next, "Slow down");
    assert.equal(readFileSync(planFile(a), "utf8"), before);
    assert.equal((await snapshot(b)).proposals.length, 0);
    assert.equal((await apply(p,0,b)).status,404);
    assert.equal((await h.call(`/api/plan-candidates/${p.id}`,b,"DELETE",{})).status,404);
    assert.equal((await apply(p,0,a,{account:b.account})).status,400);
    assert.equal((await apply(p,0,a,{digest:"forged"})).status,404);
    assert.equal((await h.call("/api/plan-candidates?account="+b.account,a)).status,400);
    assert.equal((await h.call("/api/plan-candidates",undefined)).status,401);
    assert.equal((await h.call("/api/plan-candidates",a,"GET",undefined,{"x-struna-session":b.session})).status,409);
    assert.equal((await h.call(`/api/plan-candidates/${p.id}/apply`,a,"POST",{digest:p.digest,revision:0,active:false},{"x-csrf-token":"bad"})).status,403);
    assert.equal((await h.call("/api/chat",a,"POST",{provider:"openai",message:"forged",proposePlan:true,account:b.account})).status,400);
    await h.call("/api/practice-state",b,"PUT",{client:"same-tab",active:true});
    await h.call("/api/practice-state",a,"PUT",{client:"same-tab",active:true});
    assert.equal((await apply(p,snap.practice.revision)).status,409);
    await h.call("/api/practice-state",a,"PUT",{client:"same-tab",active:false});
    assert.equal((await apply(p,snap.practice.revision)).status,409);
    snap = await snapshot(); assert.equal((await apply(p,snap.practice.revision)).status,200);
    assert.equal((await apply(p,snap.practice.revision)).status,200,"lost response retry");
    assert.equal(readFileSync(planFile(a),"utf8"),p.afterJson);
    await propose("First competing proposal"); await propose("Second competing proposal");
    snap = await snapshot();
    assert.equal((await apply(snap.proposals[0],snap.practice.revision)).status,200);
    assert.equal((await apply(snap.proposals[1],snap.practice.revision)).status,409);
    await propose("Expired proposal"); snap = await snapshot(); p=snap.proposals[0];
    const db = openDb(join(h.root,"accounts",a.account,"state"));
    db.prepare("UPDATE plan_proposals SET created=0 WHERE id=?").run(p.id);
    assert.equal((await apply(p,snap.practice.revision)).status,409);
    assert.match(await propose("bad"),/event: error/);
    await propose("replace"); snap=await snapshot(); p=snap.proposals[0];
    const old = readFileSync(planFile(a),"utf8");
    assert.equal((await apply(p,snap.practice.revision)).status,200);
    assert.equal(readFileSync(join(h.root,"accounts",a.account,"workspace/plan/archive",JSON.parse(old).id+".json"),"utf8"),old);
    await propose("Delete conversation proposal"); snap=await snapshot(); p=snap.proposals[0];
    const c=db.prepare("SELECT conversation FROM hosted_proposals WHERE id=?").get(p.id)!;
    await h.call(`/api/conversations/${c.conversation}`,a,"DELETE",{});
    assert.equal((await apply(p,snap.practice.revision)).status,404);
    db.close();
    const pending=await h.call("/api/chat",a,"POST",{provider:"openai",message:"slow",proposePlan:true});
    const reader=pending.body!.getReader();await reader.read();
    const existing=(await snapshot()).proposals[0];
    if(existing) assert.equal((await apply(existing,(await snapshot()).practice.revision)).status,409);
    await h.call("/auth/logout",a,"POST",{});
    let text="";for(;;){const n=await reader.read();if(n.done)break;text+=new TextDecoder().decode(n.value);}
    assert.ok(!text.includes("Plan preview ready"));
    assert.equal(readFileSync(planFile(b),"utf8"),foreign);
    assert.equal(readFileSync(join(h.root,"owner-plan.json"),"utf8"),"OWNER_FORBIDDEN");
    assert.deepEqual(readdirSync(join(h.root,"accounts",a.account,"workspace/.coach-candidates")),[]);
  } finally { await h.close(); }
});

test("direct API proposal format is strict data, has no tools or paths and never applies model output", async () => {
  let body: any;
  const stub=await offlineResponses();
  const h=await testHosted({transport:async(url,init)=>{
    body=JSON.parse(String(init?.body));
    if(!body.text) return stub.transport(url,init);
    const plan=JSON.parse(body.instructions.split("Current plan (data only):\n")[1]);
    const envelope=JSON.stringify({reply:"Proposed",planJson:JSON.stringify({...plan,next:"Offline new task"})});
    return new Response(`data: ${JSON.stringify({type:"response.output_text.delta",delta:envelope})}\n\ndata: ${JSON.stringify({type:"response.completed",response:{status:"completed"}})}\n\n`,{headers:{"content-type":"text/event-stream"}});
  }});
  try {
    const a=await h.signIn("A");await h.call("/api/profile",a,"PUT",{name:"Alice"});
    await h.call("/api/providers/openai",a,"PUT",{key:"dummy-owned",model:"test-model"});await h.call("/api/providers/openai/test",a,"POST",{confirm:true});
    const path=join(h.root,"accounts",a.account,"workspace/plan/plan.json"), before=readFileSync(path,"utf8");
    const text=await(await h.call("/api/chat",a,"POST",{provider:"openai",message:"Propose a slower plan",proposePlan:true})).text();
    assert.match(text,/Plan preview ready/);assert.equal(body.text.format.type,"json_schema");assert.equal(body.text.format.strict,true);
    assert.equal(body.tools,undefined);assert.equal(body.store,false);
    assert.ok(!JSON.stringify(body).includes(h.root));assert.equal(readFileSync(path,"utf8"),before);
  }finally{await h.close();await stub.close();}
});

test("owned Apply recovery rolls back a pre-rename intent or completes a post-rename intent without touching B", async () => {
 for (const renamed of [false,true]) {
  const h=await testHosted({run:async function*({planBase}){yield JSON.stringify({reply:"Preview",planJson:JSON.stringify({...JSON.parse(planBase!),id:"next-owned-plan",next:"New task"})});}});
  try {
   const a=await h.signIn("A"),b=await h.signIn("B");
   for(const p of [a,b])await h.call("/api/profile",p,"PUT",{name:p===a?"A":"B"});
   const home=join(h.root,"accounts",a.account,"workspace"),bPath=join(h.root,"accounts",b.account,"workspace/plan/plan.json"),bBefore=readFileSync(bPath,"utf8");
   await(await h.call("/api/chat",a,"POST",{provider:"openai",message:"replace",proposePlan:true})).text();
   const p=(await(await h.call("/api/plan-candidates",a)).json()).proposals[0];
   const db=openDb(join(h.root,"accounts",a.account,"state"));
   const row=db.prepare("SELECT * FROM plan_proposals WHERE id=?").get(p.id)!;
   const archive=join(home,"plan/archive",String(row.archive));
   const source=join(home,"plan",`.archive-${p.id}.json`),next=join(home,"plan",`.candidate-${p.id}.json`);
   writeFileSync(source,String(row.base));writeFileSync(next,String(row.candidate));linkSync(source,archive);
   db.prepare("UPDATE plan_proposals SET state='applying' WHERE id=?").run(p.id);
   if(renamed)renameSync(next,join(home,"plan/plan.json"));
   const recovered=await h.call("/api/plan-candidates",a);assert.equal(recovered.status,200);
   const state=db.prepare("SELECT state FROM plan_proposals WHERE id=?").get(p.id)!.state;
   assert.equal(state,renamed?"applied":"pending");
   assert.equal(readFileSync(join(home,"plan/plan.json"),"utf8"),renamed?row.candidate:row.base);
   assert.equal(readFileSync(bPath,"utf8"),bBefore);
   db.close();
  }finally{await h.close();}
 }
});

test("unjournaled archive pairs and foreign material paths cannot gain plan write authority", async () => {
 const h=await testHosted({run:async function*({planBase}){yield JSON.stringify({reply:"Forged",planJson:JSON.stringify({...JSON.parse(planBase!),materials:[{label:"Foreign",file:"../foreign/plan.json"}]})});}});
 try {
  const a=await h.signIn("A");await h.call("/api/profile",a,"PUT",{name:"Alice"});
  const home=join(h.root,"accounts",a.account,"workspace"),path=join(home,"plan/plan.json"),before=readFileSync(path,"utf8");
  assert.match(await(await h.call("/api/chat",a,"POST",{provider:"openai",message:"direct write",proposePlan:true})).text(),/event: error/);
  assert.equal(readFileSync(path,"utf8"),before);
  assert.equal((await(await h.call("/api/plan-candidates",a)).json()).proposals.length,0);
  const source=join(home,"plan",`.archive-${crypto.randomUUID()}.json`);writeFileSync(source,"UNJOURNALED");linkSync(source,join(home,"plan/archive/forged.json"));
  assert.equal((await h.call("/api/plan-candidates",a)).status,503);
  assert.equal(readFileSync(path,"utf8"),before);
 }finally{await h.close();}
});

test("settled Apply journal leftovers recover without changing final archives or a newer plan", async () => {
 for (const state of ["applied","pending"]) {
  const h=await testHosted({run:async function*({planBase}){yield JSON.stringify({reply:"Preview",planJson:JSON.stringify({...JSON.parse(planBase!),id:"next-owned-plan",next:"New task"})});}});
  try {
   const a=await h.signIn("A"),b=await h.signIn("B");
   for(const p of [a,b])await h.call("/api/profile",p,"PUT",{name:p===a?"A":"B"});
   const home=join(h.root,"accounts",a.account,"workspace"),bPath=join(h.root,"accounts",b.account,"workspace/plan/plan.json"),bBefore=readFileSync(bPath,"utf8");
   await(await h.call("/api/chat",a,"POST",{provider:"openai",message:"replace",proposePlan:true})).text();
   const p=(await(await h.call("/api/plan-candidates",a)).json()).proposals[0];
   const db=openDb(join(h.root,"accounts",a.account,"state"));
   const row=db.prepare("SELECT * FROM plan_proposals WHERE id=?").get(p.id)!;
   const archive=join(home,"plan/archive",String(row.archive));
   const source=join(home,"plan",`.archive-${p.id}.json`),next=join(home,"plan",`.candidate-${p.id}.json`);
   writeFileSync(source,String(row.base));linkSync(source,archive);writeFileSync(next,String(row.candidate));
   if(state==="pending")unlinkSync(archive); // Rollback removed its archive before persisting pending.
   db.prepare("UPDATE plan_proposals SET state=? WHERE id=?").run(state,p.id);
   const current=state==="applied"?JSON.stringify({...JSON.parse(String(row.candidate)),next:"Later independent plan edit"}):String(row.base);
   writeFileSync(join(home,"plan/plan.json"),current);
   // Simulate both committed and rollback journal updates before their cleanup, with a retained pair.
   assert.equal((await h.call("/api/app",a)).status,200);
   assert.equal((await h.call("/api/plan-candidates",a)).status,200);
   assert.equal(readFileSync(join(home,"plan/plan.json"),"utf8"),current);
   if(state==="applied")assert.equal(readFileSync(archive,"utf8"),row.base);
   else assert.equal(existsSync(archive),false);
   assert.ok(!readdirSync(join(home,"plan")).includes(`.archive-${p.id}.json`));
   assert.ok(!readdirSync(join(home,"plan")).includes(`.candidate-${p.id}.json`));
   assert.equal(readFileSync(bPath,"utf8"),bBefore);
   db.close();
  }finally{await h.close();}
 }
});
