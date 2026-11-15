import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { testHosted } from "./test-server.ts";

test("account takes isolate concurrent names, retry ids, ranges, deletion and revoked uploads", async () => {
 const h = await testHosted();
 try {
  const [a,b] = await Promise.all([h.signIn("A"),h.signIn("B")]);
  const path = "/api/recordings?blockId=same-plan&label=baseline&ext=webm&seconds=2";
  const id = crypto.randomUUID();
  const upload = (p: typeof a, body = "synthetic-audio", retry = id) => h.call(path,p,"POST",body,{"x-struna-take":retry});
  const [ra,rb] = await Promise.all([upload(a),upload(b)]);
  assert.equal(ra.status,200); assert.equal(rb.status,200);
  const [ta,tb] = await Promise.all([ra.json(),rb.json()]);
  assert.notEqual(ta.path,tb.path);
  const retries = await Promise.all([upload(a),upload(a)]);
  for (const r of retries) { assert.equal(r.status,200); assert.equal((await r.json()).id,ta.id); }
  assert.equal((await upload(a,"different")).status,409);
  assert.equal((await h.call("/api/recordings",a)).status,200);
  assert.equal((await (await h.call("/api/recordings",a)).json()).length,1);
  for (const [p,own,other] of [[a,ta,tb],[b,tb,ta]] as const) {
    assert.equal((await h.call(other.src,p)).status,404);
    assert.equal((await h.call(`/api/recordings/${other.id}`,p,"DELETE",{})).status,404);
    const range = await h.call(own.src,p,"GET",undefined,{range:"bytes=0-3"});
    assert.equal(range.status,206); assert.equal(await range.text(),"synt");
    assert.equal(range.headers.get("cache-control"),"no-store");
  }
  assert.equal((await h.call(ta.src)).status,401);
  assert.equal((await h.call("/api/recordings/file?id=../../etc/passwd",a)).status,404);
  assert.equal((await h.call(path.replace("seconds=2","seconds=601"),a,"POST","audio",{"x-struna-take":crypto.randomUUID()})).status,413);
  assert.equal((await h.call(path.replace("same-plan","..%2Fowner"),a,"POST","audio",{"x-struna-take":crypto.randomUUID()})).status,400);
  const delayed = request(h.base+path,{method:"POST",headers:{origin:h.origin,cookie:a.cookie,"x-struna":"1","x-struna-session":a.session,"x-csrf-token":a.csrf,"x-struna-take":crypto.randomUUID(),"content-length":6}});
  delayed.write("abc");
  await new Promise<void>((resolve)=>setTimeout(resolve,30));
  await h.signIn("B",a);
  const done = new Promise<number>((resolve)=>delayed.on("response",r=>{r.resume();resolve(r.statusCode!);}));
  delayed.end("def"); assert.equal(await done,401);
  const again = await h.signIn("A");
  assert.equal((await (await h.call("/api/recordings",again)).json()).length,1);
  assert.equal((await h.call(`/api/recordings/${ta.id}`,again,"DELETE",{})).status,200);
  assert.equal((await h.call(ta.src,again)).status,404);
 } finally { await h.close(); }
});
