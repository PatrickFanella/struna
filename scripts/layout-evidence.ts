import type { Page } from "playwright-core";

/** Visible viewport geometry, including clipping containers; screenshots alone cannot prove reach. */
export async function layoutEvidence(page: Page) {
  return page.evaluate(() => {
    const selectors = [".practice-choice", ".practice-preview", ".session", ".pane-file pre", ".pane-file .panescroll", ".tempocol", ".passes", ".miss", ".nextb", ".sessionbar", ".task-help", ".tool-sheet", ".tool-sheet .sheethd", ".tool-sheet > .btn", ".matlist", ".matitem", ".material-details", ".greview", ".review", ".review > .btn", ".tabs"];
    const elements = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden").slice(0, 3).map((el) => {
      const r = el.getBoundingClientRect();
      return { selector, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, inViewport: r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    }));
    return { url: location.hash, width: innerWidth, height: innerHeight, devicePixelRatio, theme: document.documentElement.dataset.theme ?? "device", darkDevice: matchMedia("(prefers-color-scheme: dark)").matches, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, overflow: document.documentElement.scrollWidth > innerWidth + 1, elements };
  });
}
