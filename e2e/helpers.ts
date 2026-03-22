import { type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

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
/**
 * Create a TestApiClient logged in as the default seeded user.
 * Call api.cleanup() in afterEach to remove test data created during the test.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const api = new TestApiClient();
  await api.login("jiayuan@multica.ai", "Jiayuan Zhang");
  const workspaces = await api.getWorkspaces();
  if (workspaces.length > 0) {
    api.setWorkspaceId(workspaces[0].id);
  }
  return api;
}

export async function openWorkspaceMenu(page: Page) {
  // Click the workspace switcher button (has ChevronDown icon)
  await page.locator("aside button").first().click();
  // Wait for dropdown to appear
  await page.locator('[class*="popover"]').waitFor({ state: "visible" });
}
