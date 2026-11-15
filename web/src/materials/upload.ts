import { accountHeaders, privateUrl } from "../api.ts";
import type { MaterialItem } from "../generic.ts";

/** The item in a materials answer, which is the item itself (or `{ item }`), with `saveError` when a copy could not be kept. */
export function readItem(data: unknown): { item: MaterialItem | null; saveError: string } {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const inner = o.item && typeof o.item === "object" ? (o.item as Record<string, unknown>) : o;
  const item = typeof inner.id === "string" && typeof inner.title === "string" ? (inner as unknown as MaterialItem) : null;
  // The server puts `saveError` on a link whose copy could not be kept.
  const saveError = [o.saveError, inner.saveError].find((v): v is string => typeof v === "string" && v !== "") ?? "";
  return { item, saveError };
}

/**
 * Send one file to the studio's materials folder. `XMLHttpRequest` rather than `fetch`,
 * because only it reports how much of an upload has gone.
 */
export function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<MaterialItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/materials/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("x-struna", "1");
    for (const [key, value] of Object.entries(accountHeaders())) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.total ? e.loaded / e.total : 0);
    xhr.onerror = () => reject(new Error("The upload did not get through. Check the connection and try again."));
    xhr.onabort = () => reject(new Error("Cancelled."));
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = (data as { error?: unknown } | undefined)?.error;
        reject(new Error(typeof message === "string" ? message : xhr.status === 413 ? "The file is too large." : `The server answered ${xhr.status}.`));
        return;
      }
      const { item } = readItem(data);
      if (item) resolve({ ...item, src: item.src ? privateUrl(item.src) : null });
      else reject(new Error("The server did not say what it saved."));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
