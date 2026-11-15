import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { materialHash } from "../materials/route.ts";
import { Account } from "../account/Account.tsx";
import { openCoach } from "../chat/Chat.tsx";
import { HANDOFF_KEY, readHandoff } from "./handoff.ts";
type Receipt = { materialId: string; destination: string; note: string; choice: string };
export function GuestImport({ session }: { session: string }) {
 const [handoff] = useState(()=>{try{return readHandoff(sessionStorage.getItem(HANDOFF_KEY));}catch{return null;}});
 const [preview,setPreview]=useState<{existing:boolean;revision:string;receipt:Receipt|null}|null>(null);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const refresh=()=>{if(handoff)void api.get<NonNullable<typeof preview>>(`/api/guest-import?id=${handoff.id}`).then(setPreview,e=>setError(e.message));};
 useEffect(refresh,[]);
 const save=async(choice:"note"|"starter")=>{
  if(!handoff||!preview)return;setBusy(true);setError("");
  try{const receipt=await api.post<Receipt>("/api/guest-import",{...handoff,choice,revision:preview.revision});setPreview({...preview,receipt});}
  catch(e){setError((e as Error).message);refresh();}finally{setBusy(false);}
 };
 const continueAction=()=>{
  if(!preview?.receipt)return;
  location.hash=materialHash(preview.receipt.materialId);
  if(handoff?.action==="coach")openCoach();
 };
 return <div className="app"><Account activeSession={session}/><main className="wrap"><div className="start gstart">
  <h1>Bring your guest practice with you</h1>
  {!handoff?<p>No completed guest exercise is waiting in this tab. Your local practice has been kept.</p>:<>
   <p>Your reflection and choices will be saved only to this signed-in private account. Your guest copy stays on this device.</p>
   <blockquote><p>{handoff.state.reflection || "No reflection added."}</p></blockquote>
   {preview?.receipt?<><p role="status">Guest practice saved. Your existing plan was kept.</p><button className="btn primary" onClick={continueAction}>{handoff.action==="coach"?"Continue to AI Coach":"Open saved practice"}</button></>:preview?<>
    <p>{preview.existing?"This account already has practice work. Keep it and choose what to add.":"Choose what to save in your private Materials."} Neither choice replaces your profile or plan.</p>
    <button className="btn primary full" disabled={busy} onClick={()=>void save("starter")}>Import starter and reflection into Materials</button>
    <button className="btn quiet full" disabled={busy} onClick={()=>void save("note")}>Keep my plan and save only the note</button>
   </>:!error&&<p role="status">Checking your private account…</p>}
  </>}
  {error&&<p role="alert">{error}</p>}
  <p><a href="/try">Continue locally or cancel</a></p><a href="/#practice">Return to Today</a>
 </div></main></div>;
}
