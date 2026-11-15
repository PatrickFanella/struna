import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { nestedHeadings } from "./markdown.ts";

test("material and Coach Markdown nest below the view heading and preserve tab whitespace", () => {
  const text = "# Tune\n\n## Fingering\n\n### Variation\n\n#### Detail\n\n##### Note\n\n###### Small note\n\n```\nD   DU  UD U\n1 & 2 & 3 & 4 &\n```\n";
  const html = renderToStaticMarkup(createElement(Markdown, { components: nestedHeadings }, text));
  assert.ok(!html.includes("<h1"));
  for (const [level, label] of [[2, "Tune"], [3, "Fingering"], [4, "Variation"], [5, "Detail"], [6, "Note"], [6, "Small note"]]) {
    assert.ok(html.includes(`<h${level}>${label}</h${level}>`));
  }
  assert.ok(html.includes("D   DU  UD U\n1 &amp; 2 &amp; 3 &amp; 4 &amp;\n"));
});
