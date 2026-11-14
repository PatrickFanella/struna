import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

import { GENERIC_REPLY_MARKDOWN, imageSrc, REPLY_MARKDOWN } from "./reply.ts";

const REPLY = "Done.\n\n![C shape](https://pics.example/c.png?w=400)\n\n![mine](materials/C%20major.png)\n\n| a |\n|---|\n| b |\n\n[a lesson](https://example.org)";

test("personal mode renders a reply as it always has, pictures included", () => {
  const html = renderToStaticMarkup(createElement(Markdown, REPLY_MARKDOWN, REPLY));
  assert.match(html, /<img src="https:\/\/pics\.example\/c\.png\?w=400" alt="C shape"\/>/);
  assert.match(html, /<table>/);
});

test("generic mode loads a remote picture through the server and names its site", () => {
  const html = renderToStaticMarkup(createElement(Markdown, GENERIC_REPLY_MARKDOWN, REPLY));
  assert.match(html, /<img src="\/api\/chat\/image\?url=https%3A%2F%2Fpics\.example%2Fc\.png%3Fw%3D400" alt="C shape" loading="lazy" referrerPolicy="no-referrer"\/>/i);
  assert.ok(!html.includes('src="https://pics.example'), html); // The browser never asks the site itself.
  assert.match(html, /Picture from pics\.example/);
  assert.match(html, /<table>/); // GFM still works.
  assert.match(html, /<a href="https:\/\/example\.org">a lesson<\/a>/);
});

test("a studio picture named by its path is served by the materials route", () => {
  const id = `f.${Buffer.from("C major.png").toString("base64url")}`;
  assert.equal(imageSrc("materials/C%20major.png"), `/api/materials/file?id=${id}`);
  assert.equal(imageSrc("./materials/Ö.png"), `/api/materials/file?id=f.${Buffer.from("Ö.png").toString("base64url")}`);
  assert.equal(imageSrc("/api/materials/file?id=f.abc"), "/api/materials/file?id=f.abc");
  for (const bad of ["//evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "", undefined]) assert.equal(imageSrc(bad), null, String(bad));
});
