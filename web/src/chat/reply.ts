import { createElement, type ImgHTMLAttributes, useState } from "react";
import remarkGfm from "remark-gfm";

/** A coach reply in personal mode: as it has always been rendered. */
export const REPLY_MARKDOWN = { remarkPlugins: [remarkGfm] };

/** Where a reply's picture is loaded from: the app's own address as it is, another site through the server. */
export function imageSrc(src: string | undefined): string | null {
  if (!src) return null;
  // A studio file named by its path, as the coach knows it: served by the materials route.
  const own = /^(?:\.\/)?materials\/(.+)$/.exec(src);
  if (own) {
    let rel: string;
    try {
      rel = decodeURIComponent(own[1]!);
    } catch {
      return null;
    }
    const bytes = new TextEncoder().encode(rel);
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `/api/materials/file?id=f.${b64}`;
  }
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  if (/^https?:\/\//i.test(src)) return `/api/chat/image?url=${encodeURIComponent(src)}`;
  return null;
}

function hostOf(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return "";
  }
}

/**
 * A picture in a studio-mode reply. The coach reads pages other people wrote, so a picture from
 * another site is fetched by the server (the image host never sees the player's device) and is
 * captioned with its site, so an unexpected one is easy to spot.
 */
function ReplyImage({ src, alt }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  const raw = typeof src === "string" ? src : undefined;
  const at = imageSrc(raw);
  if (!at || !raw) return null;
  const remote = at.startsWith("/api/chat/image");
  const host = remote ? hostOf(raw) : "";
  if (failed) return createElement("span", { className: "replyimg failed" }, `Picture could not be loaded${host ? ` (${host})` : ""}`);
  return createElement(
    "span",
    { className: "replyimg" },
    createElement("img", { src: at, alt: alt ?? "", loading: "lazy", referrerPolicy: "no-referrer", onError: () => setFailed(true) }),
    host ? createElement("small", null, `Picture from ${host}`) : null,
  );
}

/** A coach reply in studio mode: pictures go through `ReplyImage`. */
export const GENERIC_REPLY_MARKDOWN = { remarkPlugins: [remarkGfm], components: { img: ReplyImage } };
