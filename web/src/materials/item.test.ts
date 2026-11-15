import assert from "node:assert/strict";
import { test } from "node:test";

import type { MaterialItem, MaterialRef } from "../generic.ts";
import { externalLabel, materialContext, materialName, materialProvider, fillInput, kindOfName, materialPane, materialPaneItem, nameList, pastedText, refPaneItem, uploadProblem, webUrl, youtubeEmbed, youtubeId } from "./item.ts";

const item = (over: Partial<MaterialItem>): MaterialItem => ({ id: "a", title: "Blues in A", kind: "pdf", source: "studio", path: "materials/Blues in A.pdf", src: "/api/materials/file?id=a", url: null, youtube: null, note: "", size: 10, added: "2026-11-14T00:00:00Z", inPlan: false, ...over });

test("a material becomes a pane item of the matching kind", () => {
  assert.deepEqual(materialPaneItem(item({})), { key: "mat:a", label: "Blues in A", kind: "pdf", src: "/api/materials/file?id=a" });
  assert.equal(materialPaneItem(item({ kind: "tab" })).kind, "tabfile");
  assert.equal(materialPaneItem(item({ kind: "image" })).kind, "image");
  assert.equal(materialPaneItem(item({ kind: "text", note: "Lyrics" })).note, "Lyrics");
  assert.deepEqual(materialPane(item({})), { type: "file", item: materialPaneItem(item({})) });
});

test("a link opens as a link; a saved copy opens as its file and keeps the address", () => {
  const yt = materialPaneItem(item({ kind: "link", source: "link", path: null, src: null, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", youtube: "dQw4w9WgXcQ" }));
  assert.equal(yt.kind, "link");
  assert.equal(yt.youtube, "dQw4w9WgXcQ");
  assert.equal(yt.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const saved = materialPaneItem(item({ url: "https://example.org/blues.pdf" }));
  assert.equal(saved.kind, "pdf");
  assert.equal(saved.url, "https://example.org/blues.pdf");
  assert.equal(saved.youtube, undefined);
});

test("only web addresses and plain video ids reach a link or an embed", () => {
  assert.equal(materialPaneItem(item({ kind: "link", src: null, url: "javascript:alert(1)" })).url, undefined);
  assert.equal(webUrl("data:text/html,x"), null);
  assert.equal(webUrl("https://example.org/a b"), "https://example.org/a%20b");
  assert.equal(youtubeId("abc\"onload=x"), null);
  assert.equal(youtubeId("../../x"), null);
  assert.equal(youtubeEmbed("dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  assert.equal(materialPaneItem(item({ kind: "link", src: null, url: "https://youtu.be/x", youtube: "bad id" })).youtube, undefined);
});

test("plan materials: files, links and missing files", () => {
  const file: MaterialRef = { label: "Riff", key: "materials/riff.gp5", kind: "tab", src: "/api/materials/file?id=materials%2Friff.gp5" };
  assert.deepEqual(refPaneItem(file), { key: "plan:materials/riff.gp5", label: "Riff", kind: "tabfile", src: file.src });
  const link = refPaneItem({ label: "Lesson", key: "https://example.org/l", kind: "link", src: null, url: "https://example.org/l", note: "Start at 2:10" });
  assert.equal(link.kind, "link");
  assert.equal(link.note, "Start at 2:10");
  const missing = refPaneItem({ label: "Gone", key: "materials/gone.pdf", kind: "pdf", src: null, missing: true });
  assert.equal(missing.missing, true);
  assert.equal(missing.kind, "pdf");
});

test("upload checks", () => {
  assert.equal(kindOfName("Song.GP5"), "tab");
  assert.equal(kindOfName("notes"), null);
  assert.equal(uploadProblem({ name: "a.pdf", size: 5 }), null);
  assert.match(uploadProblem({ name: "a.exe", size: 5 })!, /not kept/);
  assert.match(uploadProblem({ name: "a.mp4", size: 600 * 1024 * 1024 })!, /500 MB/);
  assert.match(uploadProblem({ name: "a.pdf", size: 0 })!, /empty/);
});

test("names and prompts for the coach", () => {
  assert.equal(nameList(["a", "b"]), "a, b");
  assert.equal(nameList(["a", "b", "c"], 2), "a, b and 1 more");
  assert.equal(fillInput("Find lessons for {input}", "$& travis picking"), "Find lessons for $& travis picking");
  assert.equal(fillInput("Explain {material}: {input}", "x"), null);
  assert.equal(fillInput("No slot", "x"), null);
  assert.equal(fillInput("Find {input}", "{bpm}"), "Find {bpm}");
});

test("pasted text keeps its spacing unless it is Markdown", () => {
  assert.equal(pastedText("D  A  G\r\nI see the bad moon\n\n"), "```\nD  A  G\nI see the bad moon\n```");
  assert.equal(pastedText("# Song\n\nwords"), "# Song\n\nwords");
  assert.equal(pastedText("intro\n```\ne|--0--|\n```"), "intro\n```\ne|--0--|\n```");
});

 test("musical names keep source identity and older entries fall back", () => {
  const i = item({ title: "Publisher lesson 27: Black Mountain Rag", shortTitle: " Black Mountain Rag ", provider: "Independent Teacher" });
  assert.equal(materialName(i), "Black Mountain Rag");
  assert.equal(materialPaneItem(i).label, "Black Mountain Rag");
  assert.equal(materialPaneItem(i).key, "mat:a");
  assert.equal(i.title, "Publisher lesson 27: Black Mountain Rag");
  assert.equal(materialName(item({ shortTitle: " " })), "Blues in A");
  assert.equal(materialProvider(item({ provider: "", url: "https://www.example.org/lesson" })), "example.org");
  assert.equal(materialContext(i), "PDF · Independent Teacher");
  assert.equal(materialContext(item({ kind: "tab", source: "folder", provider: "", url: null })), "Tab · Library folder");
  assert.equal(externalLabel("https://example.org/lesson", "Independent Teacher"), "Open lesson on Independent Teacher (new tab)");
});
