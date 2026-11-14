export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "x-guitar-room": "1" } };
  if (body !== undefined) {
    init.headers = { "x-guitar-room": "1", "content-type": "application/json" };
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

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};
