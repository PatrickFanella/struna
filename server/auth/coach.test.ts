import assert from "node:assert/strict";
import { test } from "node:test";
import { testHosted } from "./test-server.ts";

test("Coach history, prompts and delayed streams belong to their account and session", async () => {
 const stopped: string[] = [];
 const h = await testHosted({ run: async function* ({ message, signal }) {
  yield "first " + message;
  await new Promise<void>((r) => { const timer = setTimeout(r,100); signal.addEventListener("abort",()=>{clearTimeout(timer);stopped.push(message);r();},{once:true}); });
  if (!signal.aborted) yield " final";
 } });
 try {
  const [a,b] = await Promise.all([h.signIn("A"),h.signIn("B")]);
  const talk = (p: typeof a, message: string, conversation?: string) => h.call("/api/chat",p,"POST",{provider:"openai",message,...(conversation ? {conversation} : {})});
  const ra = await talk(a,"Alice"), rb = await talk(b,"Bob");
  const [sa,sb] = await Promise.all([ra.text(),rb.text()]);
  assert.ok(sa.includes("Alice") && !sa.includes("Bob")); assert.ok(sb.includes("Bob") && !sb.includes("Alice"));
  const ca = (await (await h.call("/api/conversations",a)).json())[0];
  const cb = (await (await h.call("/api/conversations",b)).json())[0];
  for (const [p,other] of [[a,cb],[b,ca]] as const) {
   for (const method of ["GET","PATCH","DELETE"]) assert.equal((await h.call(`/api/conversations/${other.id}`,p,method,method === "GET" ? undefined : {title:"stolen"})).status,404);
   assert.equal((await talk(p,"forged",other.id)).status,404);
  }
  await h.call("/api/prompts/custom",a,"PUT",{prompts:[{label:"Mine",text:"Alice prompt"}]});
  assert.ok(!(await (await h.call("/api/prompts",b)).text()).includes("Alice prompt"));
  const running = await talk(a,"will stop",ca.id);
  const reader = running.body!.getReader(); await reader.read();
  await h.call("/auth/logout",a,"POST",{});
  let received = "";
  for (;;) {const next = await reader.read(); if(next.done)break; received += new TextDecoder().decode(next.value);}
  assert.ok(!received.includes(" final")); assert.ok(stopped.includes("will stop"));
  assert.equal((await h.call(`/api/conversations/${ca.id}`,a)).status,401);
  const again = await h.signIn("A");
  const history = await (await h.call(`/api/conversations/${ca.id}`,again)).json();
  assert.equal(history.messages.at(-1).role,"error");
  const disconnect = await talk(again,"disconnect",ca.id); const dr = disconnect.body!.getReader(); await dr.read(); await dr.cancel();
  assert.equal((await h.call("/api/conversations")).status,401);
  assert.equal((await h.call("/api/chat",b,"POST",{provider:"codex",message:"no host login"})).status,400);
  assert.equal((await h.call("/api/chat",b,"POST",{provider:"openai",message:"no attachments",images:["/owner"]})).status,400);
 } finally { await h.close(); }
});
