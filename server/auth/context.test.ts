import assert from "node:assert/strict";
import { test } from "node:test";
import { testHosted } from "./test-server.ts";
import { offlineResponses } from "../../scripts/offline-responses.ts";

test("Today, playing and review context resolve only owned metadata and reach only an explicit connected Send", async () => {
 const stub = await offlineResponses(), h = await testHosted({ transport: stub.transport });
 try {
  const a = await h.signIn("A"), b = await h.signIn("B");
  for (const [p, name] of [[a, "Alice"], [b, "BOB_PRIVATE"]] as const) await h.call("/api/profile", p, "PUT", { name });
  const today = await (await h.call("/api/today", a)).json();
  const foreign = await (await h.call("/api/materials/upload?name=BOB_PRIVATE.txt", b, "POST", "BOB_PRIVATE_CONTENT")).json();
  const own = await (await h.call("/api/materials/upload?name=alice-passage.txt", a, "POST", "PRIVATE_FILE_BYTES_NOT_SENT")).json();
  await h.call("/api/providers/openai", a, "PUT", { key: "ALICE_DUMMY_KEY", model: "slow-model" });
  await h.call("/api/providers/openai/test", a, "POST", { confirm: true });
  const before = stub.requests.length;
  await h.call("/api/sessions",a,"POST",{planId:today.block.id,session:{id:"full",label:"Full"},minutes:2,wentWell:"Steadier rhythm",struggled:"Rushing the beat"});
  const selection = { view: "Playing", planId: today.block.id, sessionKind: today.sessions[0].id, stageKey: today.sessions[0].stages[0].key, materialKey: `mat:${own.id}`, clickBpm: 88, confirmedBpm: 64, reflection: "My picking felt tense" };
  for (const view of ["Today", "Playing", "Review"]) {
   const res = await h.call("/api/chat/context", a, "POST", { ...selection, view });
   assert.equal(res.status, 200);
   const text = JSON.stringify(await res.json());
   for (const phrase of [view, "alice-passage", "88 BPM", "64 BPM", "not audio analysis", "picking felt tense"]) assert.ok(text.includes(phrase), phrase);
   for (const secret of ["BOB_PRIVATE", "PRIVATE_FILE_BYTES_NOT_SENT", "ALICE_DUMMY_KEY", h.root, a.session]) assert.ok(!text.includes(secret));
  }
  assert.equal(stub.requests.length, before, "context preview never calls a model");
  for (const altered of [{ ...selection, account: b.account }, { ...selection, home: h.root }, { ...selection, file: "/owner" }, { ...selection, stageKey: "foreign-stage" }, { ...selection, planId: "foreign-plan" }, { ...selection, materialKey: `mat:${foreign.id}` }]) assert.ok([400,404,409].includes((await h.call("/api/chat/context", a, "POST", altered)).status));
  const todayPreview=await(await h.call("/api/chat/context",a,"POST",{view:"Today",planId:today.block.id})).json();
  assert.match(todayPreview.summary,/Latest saved reflection/);assert.match(todayPreview.summary,/Rushing the beat/);
  for(const context of [{...selection,account:b.account},{...selection,confirmedBpm:0},{...selection,reflection:"x".repeat(6001)},{...selection,materialKey:`mat:${foreign.id}`}]) assert.ok([400,404].includes((await h.call("/api/chat",a,"POST",{provider:"openai",message:"refuse before model",context})).status));
  assert.equal(stub.requests.length,before);
  const response = await h.call("/api/chat", a, "POST", { provider: "openai", message: "Help me relax", context: selection });
  const reader = response.body!.getReader(); await reader.read();
  await h.call("/api/chat/context", a, "POST", { ...selection, view: "Review", clickBpm: 100 });
  let text = ""; for (;;) { const next = await reader.read(); if(next.done) break; text += new TextDecoder().decode(next.value); }
  assert.ok(text.includes("answer")); assert.equal(stub.requests.length, before + 1);
  const sent = JSON.stringify(stub.requests.at(-1)!.body);
  assert.ok(sent.includes("88 BPM")); assert.ok(!sent.includes("100 BPM"));
  assert.ok(sent.includes("picking felt tense")); assert.ok(!sent.includes("PRIVATE_FILE_BYTES_NOT_SENT")); assert.ok(!sent.includes("BOB_PRIVATE"));
  const conv = (await (await h.call("/api/conversations", a)).json())[0];
  const saved = await (await h.call(`/api/conversations/${conv.id}`, a)).json(); assert.match(saved.messages[0].text, /Player-confirmed clean tempo: 64 BPM/);
  stub.rejectNext(500);
  const failed = await h.call("/api/chat", a, "POST", { provider:"openai", message:"Still tense", context: selection, conversation:conv.id });
  assert.match(await failed.text(), /OpenAI is unavailable/);
  assert.equal((await h.call("/api/today", a)).status, 200);
  const late = await h.call("/api/chat", a, "POST", { provider:"openai", message:"Stop on switch", context: selection, conversation:conv.id });
  const lateReader=late.body!.getReader();await lateReader.read();
  await h.signIn("B",a);
  let tail="";for(;;){const next=await lateReader.read();if(next.done)break;tail+=new TextDecoder().decode(next.value);}
  assert.ok(!tail.includes('"text":"answer"')); assert.match(tail, /"aborted":true/);
  assert.equal((await h.call(`/api/conversations/${conv.id}`,b)).status,404);
  assert.equal((await h.call("/api/chat/context",a,"POST",selection)).status,401);
 } finally { await h.close(); await stub.close(); }
});
