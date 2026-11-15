import { useState } from "react";
import { accountHeaders, invalidateAccount } from "../api.ts";

export function DeleteAccount() {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/auth/delete-account", { method: "POST", headers: { ...accountHeaders(), "x-struna": "1", "content-type": "application/json" }, body: JSON.stringify({ confirm }) });
      if (!response.ok) throw new Error((await response.json()).error);
      invalidateAccount(); location.replace("/?account=deleted");
    } catch (e) { setError((e as Error).message || "Deletion did not finish. Retry here; access is revoked once deletion starts."); setBusy(false); }
  }
  return <div>
    <button className="btn quiet" onClick={() => setOpen(true)}>Delete account…</button>
    {open && <section aria-label="Delete your account">
      <h2>Delete your private account?</h2>
      <p>Export your practice data above and download any materials or takes you want to keep first. This cannot be undone.</p>
      <p>This removes your profile, current and archived plans, logs, tempos, materials, recordings, Coach conversations, prompts, AI connection and account caches. It signs out every Struna session and stops running requests.</p>
      <p className="srcnote">Downloads and browser drafts on your devices, your identity-provider account, and your OpenAI key at OpenAI are not deleted. Revoke the key at OpenAI separately if needed. Infrastructure backups are outside this operation: their retention has not been configured or qualified for hosted launch. Minimal deletion receipts remain for 24 hours for retries; backup restoration must honor deletion records. You can sign in later to create a fresh empty account.</p>
      <label>Type DELETE to confirm<input value={confirm} disabled={busy} autoComplete="off" onChange={e => setConfirm(e.target.value)} /></label>
      <div className="wrap"><button className="btn" disabled={busy} onClick={() => { setOpen(false); setConfirm(""); setError(""); }}>Cancel deletion</button>
        <button className="btn" disabled={busy || confirm !== "DELETE"} onClick={() => void remove()}>{busy ? "Deleting account…" : "Permanently delete my account"}</button></div>
      {error && <p role="alert">{error}</p>}
    </section>}
  </div>;
}
