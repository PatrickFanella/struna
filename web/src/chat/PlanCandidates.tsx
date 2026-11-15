import { useEffect, useState } from "react";
import { api } from "../api.ts";

type Proposal = { id: string; digest: string; before: unknown; after: unknown; beforeJson: string | null; afterJson: string; provider: string; changes: { field: string; before: unknown; after: unknown }[] };
type Snapshot = { proposals: Proposal[]; practice: { active: boolean; revision: number } };
const json = (value: unknown) => JSON.stringify(value, null, 2);
export function PlanCandidates() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setSnapshot(await api.get<Snapshot>("/api/plan-candidates")); setError(""); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    const on = () => void load();
    addEventListener("struna:proposals", on);
    addEventListener("storage", on);
    addEventListener("struna:practice-state", on);
    return () => { removeEventListener("struna:proposals", on); removeEventListener("storage", on); removeEventListener("struna:practice-state", on); };
  }, []);
  const act = async (p: Proposal, apply: boolean) => {
    if (busy || !snapshot) return;
    setBusy(true); setError("");
    try {
      if (apply) {
        if (sessionStorage.getItem("struna.session")) throw new Error("Finish or discard the active session before applying.");
        await api.post(`/api/plan-candidates/${p.id}/apply`, { digest: p.digest, revision: snapshot.practice.revision, active: false });
        dispatchEvent(new CustomEvent("struna:changed", { detail: { plan: true } }));
      } else await api.del(`/api/plan-candidates/${p.id}`);
      await load();
      dispatchEvent(new Event("struna:proposals"));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="plan-candidates" aria-label="Proposed plan changes" aria-live="off">
    {error && <p className="notice" role="alert">{error} <button className="linkbtn" onClick={() => void load()}>Reload previews</button></p>}
    {snapshot?.proposals.map((p) => <article className="plan-proposal" key={p.id}>
      <h3>Proposed plan change</h3>
      <p>Today is unchanged. Review every changed field before applying. Finish or discard practice in all open tabs first.</p>
      {p.changes.map((c) => <details key={c.field} open><summary>{c.field}</summary><div className="plan-diff"><div><b>Before</b><pre>{json(c.before)}</pre></div><div><b>After</b><pre>{json(c.after)}</pre></div></div></details>)}
      <details><summary>Complete plan JSON</summary><div className="plan-diff"><div><b>Before</b><pre>{p.beforeJson ?? "No active plan"}</pre></div><div><b>After</b><pre>{p.afterJson}</pre></div></div></details>
      {snapshot.practice.active && <p className="srcnote">Apply is unavailable while a practice session is active in this or another tab.</p>}
      <div className="row2"><button className="btn primary" disabled={busy || snapshot.practice.active || Boolean(sessionStorage.getItem("struna.session"))} onClick={() => void act(p, true)}>Apply plan change</button><button className="btn quiet" disabled={busy} onClick={() => void act(p, false)}>Dismiss proposal</button></div>
    </article>)}
  </section>;
}
