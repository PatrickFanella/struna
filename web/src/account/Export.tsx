import { useState } from "react";
import { api } from "../api.ts";

export function Export() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const data = await api.post("/api/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "struna-practice-export.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message || "Export failed. Your data is unchanged; try again."); }
    finally { setBusy(false); }
  }
  return <details><summary>Your practice data</summary>
    <p>Download readable JSON with your profile, current plan, full logs, confirmed tempos, Coach conversations and custom prompts. Free to export; your saved practice stays unchanged.</p>
    <p className="srcnote">Material files and links, audio takes, archived plans and browser-only drafts are not included. Download files from Materials and audio from each take separately. Connections, sign-in data and server settings are excluded. Limit: 20 MiB total, 1 MiB per text file, 5000 entries. Keep your download private; it contains your own writing.</p>
    <button className="btn quiet" disabled={busy} onClick={() => void download()}>{busy ? "Preparing export…" : "Export practice data"}</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
