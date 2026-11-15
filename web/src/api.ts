export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "x-struna": "1" } };
  if (body !== undefined) {
    init.headers = { "x-struna": "1", "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
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
      const value = localStorage.getItem(key);
      if (value !== null || !key.startsWith("struna.")) return value;
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
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      if (key.startsWith("struna.")) localStorage.removeItem(key.replace(/^struna\./, "guitar-room."));
    } catch {
      /* storage unavailable */
    }
  },
};
