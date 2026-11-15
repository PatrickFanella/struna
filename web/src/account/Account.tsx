import { useEffect, useState } from "react";
import { api, invalidateAccount } from "../api.ts";

type AccountState = { signedIn: boolean; account?: string; csrf?: string; session?: string };
/** Account controls discard the document when its cookie identity changes. */
export function Account({ activeSession }: { activeSession?: string | undefined } = {}) {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState(new URLSearchParams(location.search).has("signin") ? "Sign-in did not finish. Try again." : "");
  const [busy, setBusy] = useState(false);
  const refresh = () => api.get<AccountState>("/api/account").then((next) => {
    if (activeSession && next.session !== activeSession) { invalidateAccount(); location.replace("/"); return; }
    setState(next);
  }, () => { setState({ signedIn: false }); setError("Could not check your session. Try signing in again."); });
  useEffect(() => { void refresh(); const on = () => { void refresh(); }; addEventListener("focus", on); const changed = () => location.replace("/"); addEventListener("struna:account-changed", changed);
    return () => { removeEventListener("focus", on); removeEventListener("struna:account-changed", changed); }; }, []);
  const login = async () => {
    setBusy(true); setError("");
    try { const result = await api.post<{ redirect: string }>("/auth/login", { returnTo: location.hash }); location.assign(result.redirect); }
    catch { setError("Sign-in is unavailable. Please try again."); setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/auth/logout", { method: "POST", headers: { "x-struna": "1", "x-csrf-token": state?.csrf ?? "" } });
      if (!res.ok && res.status !== 401) throw new Error();
      // Drop mounted state; account-scoped drafts remain separate from guest and owner data.
      invalidateAccount(); location.replace("/");
    } catch { setError("Could not sign out. Try again."); setBusy(false); }
  };
  if (activeSession) return <div className="wrap"><span>Private account</span> <button className="btn quiet" disabled={busy || !state} onClick={() => void logout()}>Sign out</button>{error && <p role="alert">{error}</p>}</div>;
  return <div className="app"><main className="wrap"><div className="start gstart">
    <span className="brandmark" aria-hidden="true" /><h1>Your private practice</h1>
    {state === null ? <p role="status">Checking your session…</p> : <>
      <p>{state.signedIn ? "You are signed in. Private practice is being prepared; your account cannot access the owner’s library or tools." : "Sign in with the configured identity provider to return to your private account."}</p>
      <button className="btn primary" disabled={busy} onClick={() => void (state.signedIn ? logout() : login())}>{busy ? "Please wait…" : state.signedIn ? "Sign out" : "Sign in"}</button>
    </>}
    <p><a href="/try">Try a short exercise without an account</a></p>
    {error && <p role="alert">{error}</p>}
  </div></main></div>;
}
