/** #110 browser-engine audio paths with an original generated E2 tone, not a physical mic/ears. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright-core";
import { nextStage } from "./practice-steps.ts";

const out=resolve(process.argv[2]??`/tmp/struna-audio-${Date.now()}`);mkdirSync(out,{recursive:true});
let fixture: ReturnType<typeof spawn> | undefined;
let base=process.env.STRUNA_QUALIFICATION_URL;
if (!base) {
 const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,"127.0.0.1",r));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
 base=`http://localhost:${port}`;
 fixture=spawn(process.execPath,[resolve(import.meta.dirname,"qualification-studio.ts"),resolve(out,"studio-fixture")],{env:{...process.env,PORT:String(port)},stdio:["ignore","ignore","ignore"]});
 const stopFixture=()=>{if(fixture?.exitCode===null)fixture.kill();};process.once("exit",stopFixture);
 writeFileSync(resolve(out,"fixture.pid"),String(fixture.pid));
 let ready=false;
 for(let n=0;n<100;n++){if(fixture.exitCode!==null)throw new Error("Scratch audio fixture stopped");if(await fetch(base+"/api/health").then(r=>r.ok,()=>false)){ready=true;break;}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,"scratch audio fixture must become healthy");
}
assert.ok(/^http:\/\/localhost:\d+$/.test(base),"scratch localhost fixture only");
const tone=resolve(out,"original-e2.wav");
execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=82.406889:sample_rate=48000:duration=60","-ac","1","-c:a","pcm_s16le",tone]);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM??(existsSync("/usr/bin/chromium")?"/usr/bin/chromium":chromium.executablePath()),args:["--use-fake-device-for-media-stream",`--use-file-for-fake-audio-capture=${tone}`]});
const context=await browser.newContext({permissions:["microphone"],viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
 const w=window as any;w.audioContexts=[];w.captures=[];
 const Original=window.AudioContext;
 window.AudioContext=class extends Original{constructor(...args:any[]){super(...args);w.audioContexts.push(this);}};
 const native=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await native(constraints);w.captures.push(stream);return stream;};
});
const page=await context.newPage();const errors:string[]=[];const responses:unknown[]=[];page.on("response",async r=>{if(r.url().includes("/api/recordings")&&r.request().method()==="POST")responses.push({status:r.status(),body:await r.text().catch(()=>"response closed")});});page.on("pageerror",e=>errors.push(e.message));
const receipt:any={input:"original generated 82.406889 Hz E2 WAV through Chromium fake capture",physicalMicrophone:false,humanAudibility:false};
try {
 await page.goto(base+"/?token="+"0".repeat(64));await page.waitForURL(base+"/");
 await page.locator(".top").getByRole("button",{name:"Tuner",exact:true}).click();
 assert.equal(await page.evaluate(()=>(window as any).captures.length),0);
 await page.getByRole("button",{name:"Start microphone",exact:true}).click();
 await page.locator(".note").filter({hasText:"E2"}).waitFor();await page.getByText("In tune",{exact:true}).waitFor();
 receipt.tuner=await page.locator(".note").innerText();
 await page.getByRole("button",{name:"Stop microphone",exact:true}).click();
 assert.equal(await page.evaluate(()=>(window as any).captures[0].getTracks()[0].readyState),"ended");
 receipt.captureReleased=true;
 await page.getByRole("tab",{name:"Metronome",exact:true}).click();
 await page.evaluate(()=>{
  const w=window as any,ctx=w.audioContexts[0];w.output=ctx.createMediaStreamDestination();
  // Keep the tee stream clock live between short click nodes; this source is silent.
  w.clock=ctx.createOscillator();const silence=ctx.createGain();silence.gain.value=0;w.clock.connect(silence).connect(w.output);w.clock.start();
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(this:AudioNode,destination:any,...args:any[]){
   if(destination===ctx.destination)connect.call(this,w.output);
   return (connect as any).call(this,destination,...args);
  } as any;
  w.outputChunks=[];w.outputRecorder=new MediaRecorder(w.output.stream);
  w.outputRecorder.ondataavailable=(e:BlobEvent)=>{if(e.data.size)w.outputChunks.push(e.data);};w.outputRecorder.start();
 });
 await page.getByRole("button",{name:"Start",exact:true}).click();
 await page.waitForTimeout(2500);
 await page.getByRole("button",{name:"Stop",exact:true}).click();
 receipt.metronome=await page.evaluate(async()=>{
  const w=window as any,rec=w.outputRecorder;
  await new Promise<void>(r=>{rec.onstop=()=>r();rec.stop();});
  w.clock.stop();
  const blob=new Blob(w.outputChunks,{type:rec.mimeType});w.metronomeBlob=blob;
  const data=await w.audioContexts[0].decodeAudioData(await blob.arrayBuffer());const pcm=data.getChannelData(0);
  let peak=0,sum=0;for(const x of pcm){peak=Math.max(peak,Math.abs(x));sum+=x*x;}
  return{duration:data.duration,peak,rms:Math.sqrt(sum/pcm.length),bytes:blob.size,codec:rec.mimeType};
 });
 writeFileSync(resolve(out,"audio-diagnostic.json"),JSON.stringify(receipt,null,2));
 assert.ok(receipt.metronome.duration>1);assert.ok(receipt.metronome.peak>0.02);assert.ok(receipt.metronome.rms>0.002);
 writeFileSync(resolve(out,"rendered-metronome.webm"),Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await(window as any).metronomeBlob.arrayBuffer())])));
 await page.getByRole("button",{name:"Done",exact:true}).click();
 await page.getByRole("button",{name:"Start 20 min practice",exact:true}).click();await nextStage(page);
 await page.getByRole("button",{name:"Tools",exact:true}).click();
 await page.getByRole("button",{name:"Record take",exact:true}).click();await page.getByRole("button",{name:/Stop take/}).waitFor();
 await page.waitForTimeout(1800);await page.getByRole("button",{name:/Stop take/}).click();
 await page.locator(".takebox").getByRole("button",{name:"Save take",exact:true}).click();
 const audio=page.locator(".takesaved audio");
 try { await audio.waitFor({timeout:5000}); } catch(e) { await page.screenshot({path:resolve(out,"save-diagnostic.png")});writeFileSync(resolve(out,"save-diagnostic.json"),JSON.stringify({responses,text:await page.locator("body").innerText()},null,2));throw e; }
 receipt.take=await audio.evaluate(async(el:HTMLAudioElement)=>{
  await Promise.race([el.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error(JSON.stringify({src:el.currentSrc,network:el.networkState,ready:el.readyState,error:el.error?.message}))),10000))]);await new Promise(r=>setTimeout(r,350));const playing={time:el.currentTime,duration:el.duration,paused:el.paused,error:el.error?.message??null};el.pause();return playing;
 });
 assert.ok(receipt.take.time>0);assert.equal(receipt.take.paused,false);assert.equal(receipt.take.error,null);
 receipt.takeSavedInScratch=true;console.log("Synthetic take save and playback passed");
 // A browser permission denial (no getUserMedia replacement) remains recoverable.
 await page.locator(".top").getByRole("button",{name:"Tuner",exact:true}).click();
 const cdp=await context.newCDPSession(page);const {targetInfo}=await cdp.send("Target.getTargetInfo");
 assert.ok(targetInfo.browserContextId,"probe must use an isolated browser context");
 await cdp.send("Browser.setPermission",{permission:{name:"microphone"},setting:"denied",origin:base,browserContextId:targetInfo.browserContextId});
 assert.equal(await page.evaluate(async()=>(await navigator.permissions.query({name:"microphone" as PermissionName})).state),"denied");
 await page.getByRole("button",{name:"Start microphone",exact:true}).click();
 await page.getByText("Microphone permission denied",{exact:true}).waitFor();receipt.browserPermissionDenied=true;
 await page.screenshot({path:resolve(out,"browser-mic-denied.png")});
 assert.deepEqual(errors,[]);receipt.pageErrors=errors;receipt.browser=await browser.version();
 writeFileSync(resolve(out,"receipts.json"),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(e){console.error(e);writeFileSync(resolve(out,"failure.json"),JSON.stringify({error:String(e),receipt},null,2));throw e;}finally{await context.close();await browser.close();if(fixture?.exitCode===null){fixture.kill();await new Promise(r=>fixture!.once("exit",r));}}
