import { useEffect, useState } from "react";
import { api } from "../api.ts";

type AccountState = { signedIn: boolean; account?: string; csrf?: string };
/** Hosted shell intentionally mounts no owner Practice, Materials or Coach components. */
export function Account() {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState(new URLSearchParams(location.search).has("signin") ? "Sign-in did not finish. Try again." : "");
  const [busy, setBusy] = useState(false);
  const refresh = () => api.get<AccountState>("/api/account").then(setState, () => { setState({ signedIn: false }); setError("Could not check your session. Try signing in again."); });
  useEffect(() => { void refresh(); const on = () => { void refresh(); }; addEventListener("focus", on); return () => removeEventListener("focus", on); }, []);
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
      // Hosted shell has no private caches. Reload drops all component/session state, including other tabs on focus.
      sessionStorage.clear(); location.replace("/");
    } catch { setError("Could not sign out. Try again."); setBusy(false); }
  };
  return <div className="app"><main className="wrap"><div className="start gstart">
    <span className="brandmark" aria-hidden="true" /><h1>Your private practice</h1>
    {state === null ? <p role="status">Checking your session…</p> : <>
      <p>{state.signedIn ? "You are signed in. Private practice is being prepared; your account cannot access the owner’s library or tools." : "Sign in with the configured identity provider to return to your private account."}</p>
      <button className="btn primary" disabled={busy} onClick={() => void (state.signedIn ? logout() : login())}>{busy ? "Please wait…" : state.signedIn ? "Sign out" : "Sign in"}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div></main></div>;
}
