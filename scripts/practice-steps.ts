import type { Page } from "playwright-core";

/** Existing practice walks skip rest; the break-specific smoke covers the countdown itself. */
export async function nextStage(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Next stage/ }).press("Enter");
  await page.getByRole("button", { name: "Skip break", exact: true }).press("Enter");
}
