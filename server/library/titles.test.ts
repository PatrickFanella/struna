import assert from "node:assert/strict";
import { test } from "node:test";

import { artistWorksTitle, bookTitle, cgoGroupKey, fileTitle, slugTitle } from "./titles.ts";

test("ArtistWorks titles drop the number, initials and suffix", () => {
  assert.equal(artistWorksTitle("05a_BS_You Are My Sunshine_Rhythm_Intro_ArtistWorks.mp4"), "You Are My Sunshine Rhythm Intro");
  assert.equal(artistWorksTitle("BS_Little Maggie_ArtistWorks.mp3"), "Little Maggie");
  assert.equal(artistWorksTitle("CE_This Land is Your Land_100bpm_ArtistWorks.mp3"), "This Land is Your Land 100bpm");
});

test("CGO group keys come from the bracketed id or the stem", () => {
  assert.equal(cgoGroupKey("The Best Country Strumming Patterns ｜ Guitar Lesson [132673069].mkv"), "vimeo:132673069");
  assert.equal(cgoGroupKey("132673069.mp4"), "vimeo:132673069");
  assert.equal(cgoGroupKey("Smooth Flowing ｜ #bluegrass [X8U8Zm9KYlQ].mkv"), "youtube:X8U8Zm9KYlQ");
  assert.equal(cgoGroupKey("WwKr2zIYse0.mp4"), "youtube:WwKr2zIYse0");
  assert.equal(cgoGroupKey("random file.mp4"), null);
});

test("book and slug titles", () => {
  assert.equal(bookTitle("Guitar Aerobics (Troy Nelson) (z-library.sk, 1lib.sk, z-lib.sk).pdf"), "Guitar Aerobics (Troy Nelson)");
  assert.equal(bookTitle("Tony Rice Collection Tab Book (Marcel Ardans).pdf"), "Tony Rice Collection Tab Book (Marcel Ardans)");
  assert.equal(fileTitle("blues-scale-charts-cgo-member-download-65e52dbd.pdf"), "blues scale charts cgo member download");
  assert.equal(slugTitle("https://countryguitaronline.com/12-bar-bluegrass-in-g-creekside-lesson/"), "12 bar bluegrass in g creekside lesson");
});
