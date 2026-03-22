import { type Page } from "@playwright/test";

/**
 * Login as the seeded user (has workspace and issues).
 */
export async function loginAsDefault(page: Page) {
  await page.goto("/login");
  await page.fill('input[placeholder="Name"]', "Jiayuan Zhang");
  await page.fill('input[placeholder="Email"]', "jiayuan@multica.ai");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/issues", { timeout: 10000 });
}

/**
 * Open the workspace switcher dropdown menu.
 */
export async function openWorkspaceMenu(page: Page) {
  // Click the workspace switcher button (has ChevronDown icon)
  await page.locator("aside button").first().click();
  // Wait for dropdown to appear
  await page.locator('[class*="popover"]').waitFor({ state: "visible" });
}
