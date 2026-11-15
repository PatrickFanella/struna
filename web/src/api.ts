/** Fixed for this document: a stale tab cannot follow a changed session cookie. */
function bootstrap() {
  try { return JSON.parse(document.getElementById("app-info")?.textContent ?? "{}"); } catch { return {}; }
}
let scope = bootstrap();
let scopeReady = typeof scope.mode === "string";
export function initializeAccountScope(info: { mode: string; account?: string; session?: string; csrf?: string }) {
  if (scopeReady) return;
  scope = { ...info };
  scopeReady = true;
}
let invalidated = false;
export function invalidateAccount() { invalidated = true; }
const scopedKey = (key: string) => scope.mode === "hosted" ? `struna.account.${scope.account ?? "anonymous"}.${key}` : key;
export const privateSession = {
  getItem: (key: string) => sessionStorage.getItem(scopedKey(key)),
  setItem: (key: string, value: string) => sessionStorage.setItem(scopedKey(key), value),
  removeItem: (key: string) => sessionStorage.removeItem(scopedKey(key)),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (invalidated) throw new ApiError(409, "Your account changed. Reload before continuing.");
  const headers: Record<string, string> = { "x-struna": "1" };
  if (scope.mode === "hosted" && scope.session) { headers["x-struna-session"] = scope.session; headers["x-csrf-token"] = scope.csrf; }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  if (invalidated) throw new ApiError(409, "Your account changed. Reload before continuing.");
  const data = text ? JSON.parse(text) : undefined;
  if (scope.mode === "hosted" && (res.status === 401 || res.status === 409)) { invalidateAccount(); dispatchEvent(new Event("struna:account-changed")); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export const api = {
  get: <T,>(path: string) => call<T>("GET", path),
  put: <T,>(path: string, body: unknown) => call<T>("PUT", path, body),
  post: <T,>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T,>(path: string, body: unknown) => call<T>("PATCH", path, body),
  del: <T,>(path: string) => call<T>("DELETE", path),
};

/** Carry an open tab's session and review draft forward without replacing newer state. */
export function migrateSessionStorage(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith("guitar-room.")) continue;
      const current = key.replace(/^guitar-room\./, "struna.");
      if (sessionStorage.getItem(current) === null) sessionStorage.setItem(current, sessionStorage.getItem(key)!);
      sessionStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key: string): string | null {
    try {
      const value = localStorage.getItem(key === "struna.theme" ? key : scopedKey(key));
      if (value !== null || scope.mode === "hosted" || !key.startsWith("struna.")) return value;
      const previous = localStorage.getItem(key.replace(/^struna\./, "guitar-room."));
      if (previous !== null) {
        try { localStorage.setItem(key, previous); } catch { /* A full store can still be read. */ }
      }
      return previous;
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      const target = key === "struna.theme" ? key : scopedKey(key);
      if (value === null) localStorage.removeItem(target);
      else localStorage.setItem(target, value);
      if (key.startsWith("struna.")) localStorage.removeItem(key.replace(/^struna\./, "guitar-room."));
    } catch {
      /* storage unavailable */
    }
  },
};
