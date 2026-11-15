import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { testHosted } from "./test-server.ts";

test("AI connections encrypt separately, redact responses and refuse host/foreign endpoint authority", async () => {
 const h = await testHosted({run: async function* ({signal}) { yield "started"; await new Promise<void>(r=>signal.addEventListener("abort",()=>r(),{once:true})); }});
 try {
  const [a,b] = await Promise.all([h.signIn("A"),h.signIn("B")]);
  const keys = [randomBytes(32).toString("hex"),randomBytes(32).toString("hex")];
  for(const [p,key] of [[a,keys[0]],[b,keys[1]]] as const) {
   const saved = await h.call("/api/providers/openai",p,"PUT",{key,model:"test-model"});
   assert.equal(saved.status,200); assert.ok(!(await saved.text()).includes(key!));
   const providers = await (await h.call("/api/providers",p)).json();
   assert.deepEqual(providers.list.map((x:any)=>x.id),["openai"]); assert.equal(providers.deviceSignIn,false);
   assert.equal((await h.call("/api/providers/openai",p)).status,200);
   const file = join(h.root,"accounts",p.account,"private","openai.enc");
   const bytes = readFileSync(file); assert.ok(!bytes.includes(key!)); assert.equal(statSync(file).mode & 0o777,0o600);
  }
  for(const id of [a.account,b.account,"codex","claude","chatgpt","endpoint","bedrock"]) assert.equal((await h.call(`/api/providers/${id}`,a,"PUT",{key:keys[0]})).status,400);
  assert.equal((await h.call("/api/providers/openai",a,"PUT",{key:keys[0],baseUrl:"http://127.0.0.1:1"})).status,400);
  assert.equal((await h.call("/api/providers/openai",undefined,"PUT",{key:keys[0]})).status,401);
  const stream = await h.call("/api/chat",a,"POST",{provider:"openai",message:"stop on replacement"});
  const reader = stream.body!.getReader(); await reader.read();
  assert.equal((await h.call("/api/providers/openai",a,"DELETE",{})).status,200);
  let received=""; for(;;){ const n=await reader.read();if(n.done)break;received+=new TextDecoder().decode(n.value); }
  assert.ok(received.includes('"aborted":true'));
  assert.equal((await (await h.call("/api/providers/openai",a)).json()).connected,false);
  assert.equal((await (await h.call("/api/providers/openai",b)).json()).connected,true);
  // Moving ciphertext between accounts fails authenticated decryption.
  copyFileSync(join(h.root,"accounts",b.account,"private","openai.enc"),join(h.root,"accounts",a.account,"private","openai.enc"));
  const invalid = await h.call("/api/providers/openai",a); assert.equal(invalid.status,503); assert.ok(!(await invalid.text()).includes(keys[1]!));
  assert.equal((await h.call("/api/providers/openai",a,"DELETE",{})).status,200);
  const tampered = join(h.root,"accounts",b.account,"private","openai.enc"); const bytes = readFileSync(tampered);bytes[30]=bytes[30]! ^ 1;writeFileSync(tampered,bytes);
  assert.equal((await h.call("/api/providers/openai",b)).status,503);
  assert.equal(statSync(join(h.root,"secrets","credentials.key")).mode & 0o777,0o600);
 } finally { await h.close(); }
});
