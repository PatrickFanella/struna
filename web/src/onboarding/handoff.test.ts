import assert from "node:assert/strict";
import { test } from "node:test";
import { freshGuest } from "./guest.ts";
import { readHandoff } from "./handoff.ts";
test("guest handoff admits only completed validated state and a named intended action",()=>{
 const value={id:crypto.randomUUID(),action:"coach",state:{...freshGuest(),step:"done",reflection:"kept"}};
 assert.deepEqual(readHandoff(JSON.stringify(value)),value);
 for(const bad of [null,{}, {...value,id:"../../owner"},{...value,action:"https://elsewhere.example"},{...value,state:{...value.state,step:"practice"}},{...value,state:{...value.state,focus:"foreign"}}])assert.equal(readHandoff(JSON.stringify(bad)),null);
});
