import assert from "node:assert/strict";
import { test } from "node:test";
import { testHosted } from "./test-server.ts";
import { freshGuest } from "../../shared/guest.ts";

test("guest handoffs bind to login identity, save idempotently and preserve existing account work", async () => {
 const h=await testHosted();
 const bind=async(subject:string,id:string)=>{
   const start=await h.call("/auth/login",undefined,"POST",{returnTo:"#guest-import",handoff:id});assert.equal(start.status,200);
   const state=new URL((await start.json()).redirect).searchParams.get("state");
   const finish=await fetch(`${h.base}/auth/callback?state=${state}&code=${subject}`,{headers:{cookie:start.headers.getSetCookie()[0]!.split(";")[0]!},redirect:"manual"});
   assert.equal(finish.headers.get("location"),"/#guest-import");
   const cookie=finish.headers.getSetCookie().find(x=>x.startsWith("__Host-struna-session="))!.split(";")[0]!;
   return {cookie,...await(await fetch(h.base+"/api/account",{headers:{cookie}})).json()};
 };
 try{
  const id=crypto.randomUUID(),a=await bind("A",id),b=await h.signIn("B");
  const state={...freshGuest(),step:"done",focus:"rhythm",reflection:"My private guest note"};
  const preview=await(await h.call(`/api/guest-import?id=${id}`,a)).json();assert.equal(preview.existing,false);
  const body={id,state,action:"save",choice:"starter",revision:preview.revision};
  const [one,two]=await Promise.all([h.call("/api/guest-import",a,"POST",body),h.call("/api/guest-import",a,"POST",body)]);
  assert.equal(one.status,200);assert.equal(two.status,200);
  const [saved,replayed]=await Promise.all([one.json(),two.json()]);assert.equal(saved.materialId,replayed.materialId);
  assert.equal((await(await h.call(`/api/guest-import?id=${id}`,a)).json()).receipt.note,state.reflection);
  assert.equal((await(await h.call("/api/materials",a)).json()).items.length,1);
  const text=await(await h.call(saved.src,a)).text();assert.ok(text.includes("My private guest note"));assert.ok(text.includes("Find four steady beats"));
  assert.equal((await h.call("/api/guest-import",a,"POST",{...body,choice:"note"})).status,409);
  assert.equal((await h.call(`/api/guest-import?id=${id}`,b)).status,409);
  assert.equal((await h.call("/api/guest-import",b,"POST",body)).status,409);
  assert.equal((await h.call("/api/guest-import",undefined,"POST",body)).status,401);
  await h.call("/api/profile",a,"PUT",{name:"Keep my profile",minutesPerSession:15});
  const before=await(await h.call("/api/today",a)).json();
  const nextId=crypto.randomUUID(),again=await bind("A",nextId);
  const next=await(await h.call(`/api/guest-import?id=${nextId}`,again)).json();assert.equal(next.existing,true);
  assert.equal((await h.call("/api/guest-import",again,"POST",{...body,id:nextId,revision:"stale"})).status,409);
  assert.equal((await h.call("/api/guest-import",again,"POST",{...body,id:nextId,choice:"note",revision:next.revision})).status,200);
  const after=await(await h.call("/api/today",again)).json();assert.deepEqual(after.block,before.block);assert.equal(after.profile.name,"Keep my profile");
  assert.equal((await h.call("/api/guest-import",again,"POST",{...body,id:crypto.randomUUID(),state:{...state,focus:"bad"}})).status,409);
  assert.equal((await h.call("/auth/login",undefined,"POST",{returnTo:"https://evil.example",handoff:crypto.randomUUID()})).status,400);
  const canceledId=crypto.randomUUID();const start=await h.call("/auth/login",undefined,"POST",{returnTo:"#guest-import",handoff:canceledId});
  assert.equal(start.status,200);assert.equal((await h.call(`/api/guest-import?id=${canceledId}`,again)).status,409);
 }finally{await h.close();}
});
