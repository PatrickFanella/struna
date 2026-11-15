import assert from "node:assert/strict";
import { test } from "node:test";
import { responses } from "./responses.ts";
import { offlineResponses } from "../../scripts/offline-responses.ts";
import { testHosted } from "./test-server.ts";

test("direct Responses adapter streams only bounded completed text and sanitizes upstream failures", async () => {
  const stub = await offlineResponses();
  try {
    const run = responses(stub.transport);
    const input = { key: "dummy-player-key", model: "test-model", message: "My question", signal: new AbortController().signal };
    let text = ""; for await (const delta of run(input)) text += delta;
    assert.equal(text,"Offline answer");
    const req=stub.requests[0]!;
    assert.equal(req.authorization,"Bearer dummy-player-key");
    assert.equal(req.body.store,false);assert.equal(req.body.stream,true);assert.equal(req.body.max_output_tokens,2048);
    assert.equal(req.body.tools,undefined);assert.equal(req.body.previous_response_id,undefined);
    for(const status of [400,401,403,404,429,500]) {
      await assert.rejects(async()=>{for await(const _ of run({...input,model:`fail-${status}`})){}},e=>{
        assert.ok(!(e as Error).message.includes(input.key));return /OpenAI/.test((e as Error).message);
      });
    }
    await assert.rejects(async()=>{for await(const _ of run({...input,model:"incomplete-model"})){}},/incomplete/);
    const denied = responses(async()=>{throw new Error(input.key);});
    await assert.rejects(async()=>{for await(const _ of denied(input)){}},/Check network/);
    const abort=new AbortController(), slow=run({...input,model:"slow-model",signal:abort.signal});
    assert.equal((await slow.next()).value,"Offline "); abort.abort();
    await assert.rejects(()=>slow.next());
  } finally {await stub.close();}
});

test("saved/tested connections, explicit sends, private history and disconnect use only the player's key",async()=>{
 const stub=await offlineResponses(), h=await testHosted({transport:stub.transport});
 try {
  const [a,b]=await Promise.all([h.signIn("A"),h.signIn("B")]);
  const save=(p:typeof a,key:string,model="test-model")=>h.call("/api/providers/openai",p,"PUT",{key,model});
  const chat=(p:typeof a,message:string,conversation?:string,extra={})=>h.call("/api/chat",p,"POST",{provider:"openai",message,...(conversation?{conversation}:{}),...extra});
  assert.equal((await chat(a,"not connected")).status,409);assert.equal(stub.requests.length,0);
  await Promise.all([save(a,"dummy-alice-key"),save(b,"dummy-bob-key")]);
  assert.equal(stub.requests.length,0,"saving is free of provider requests");
  assert.equal((await(await h.call("/api/providers/openai",a)).json()).tested,null);
  assert.equal((await h.call("/api/providers/openai/test",a,"POST",{})).status,400);
  const tested=await h.call("/api/providers/openai/test",a,"POST",{confirm:true});assert.equal(tested.status,200);assert.ok((await tested.json()).tested);
  assert.equal(stub.requests[0]!.authorization,"Bearer dummy-alice-key");
  assert.equal((await chat(b,"untested")).status,409);
  await h.call("/api/providers/openai/test",b,"POST",{confirm:true});
  assert.equal((await chat(a,"automatic",undefined,{auto:"pain"})).status,400);assert.equal(stub.requests.length,2);
  const [ra,rb]=await Promise.all([chat(a,"Alice question"),chat(b,"Bob question")]);
  assert.match(await ra.text(),/Offline/);assert.match(await rb.text(),/Offline/);
  const ca=(await(await h.call("/api/conversations",a)).json())[0];
  const cb=(await(await h.call("/api/conversations",b)).json())[0];
  assert.equal((await chat(b,"forged",ca.id)).status,404);
  await(await chat(a,"Follow up",ca.id)).text();
  const follow=stub.requests.at(-1)!;assert.equal(follow.authorization,"Bearer dummy-alice-key");
  assert.deepEqual(follow.body.input,[{role:"user",content:"Alice question"},{role:"assistant",content:"Offline answer"},{role:"user",content:"Follow up"}]);
  assert.ok(!JSON.stringify(follow.body).includes("Bob question"));
  assert.equal((await h.call(`/api/conversations/${cb.id}`,a)).status,404);
  for(const code of [401,403,429,500]) {
   await save(a,"dummy-alice-key",`fail-${code}`);
   const fail=await h.call("/api/providers/openai/test",a,"POST",{confirm:true}); assert.equal(fail.status,502);
   assert.ok(!(await fail.text()).includes("dummy-alice-key"));
   assert.equal((await chat(a,"failed validation cannot send")).status,409);
   await save(a,"dummy-alice-key"); await h.call("/api/providers/openai/test",a,"POST",{confirm:true});
   stub.rejectNext(code);
   const stream=await(await chat(a,"test provider failure")).text();assert.ok(stream.includes("event: error"));assert.ok(!stream.includes("dummy-alice-key"));
  }
  stub.rejectNext(401);
  assert.equal((await h.call("/api/providers/openai/test",a,"POST",{confirm:true})).status,502);
  assert.equal((await(await h.call("/api/providers/openai",a)).json()).tested,null);
  await save(a,"dummy-alice-key","slow-model");
  await h.call("/api/providers/openai/test",a,"POST",{confirm:true});
  const running=await chat(a,"will disconnect");const reader=running.body!.getReader();await reader.read();
  assert.equal((await h.call("/api/providers/openai/test",a,"POST",{confirm:true})).status,409);
  assert.equal((await h.call("/api/providers/openai",a,"DELETE",{})).status,200);
  let received="";for(;;){const n=await reader.read();if(n.done)break;received+=new TextDecoder().decode(n.value);}
  assert.ok(!received.includes('"text":"answer"'));assert.ok(received.includes('"aborted":true'));
  assert.equal((await chat(a,"no fallback")).status,409);
  assert.equal((await(await h.call("/api/providers/openai",b)).json()).connected,true);
  assert.equal((await h.call("/api/providers/endpoint",a,"PUT",{key:"dummy-key",model:"test",baseUrl:"http://127.0.0.1"})).status,400);
  assert.equal((await h.call("/api/providers/openai/test",undefined,"POST",{confirm:true})).status,401);
 }finally{await h.close();await stub.close();}
});

test("validation serializes account requests and sign-out cannot leave a successful late test",async()=>{
 const stub=await offlineResponses();let started=()=>{};
 const h=await testHosted({transport:async(url,init)=>{const r=await stub.transport(url,init);started();return r;}});
 try {
  const a=await h.signIn("A");
  await h.call("/api/providers/openai",a,"PUT",{key:"dummy-slow-key",model:"slow-model"});
  const began=new Promise<void>(r=>{started=r;});
  const pending=h.call("/api/providers/openai/test",a,"POST",{confirm:true});await began;
  assert.equal((await h.call("/api/chat",a,"POST",{provider:"openai",message:"no concurrent charge"})).status,409);
  assert.equal((await h.call("/api/providers/openai/test",a,"POST",{confirm:true})).status,409);
  await h.call("/auth/logout",a,"POST",{});
  const stopped=await pending;assert.ok(stopped.status>=400);assert.ok(!(await stopped.text()).includes("dummy-slow-key"));
  const again=await h.signIn("A");
  assert.equal((await(await h.call("/api/providers/openai",again)).json()).tested,null);
 }finally{await h.close();await stub.close();}
});
