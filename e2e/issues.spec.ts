import { test, expect } from "@playwright/test";
import { loginAsDefault } from "./helpers";

test.describe("Issues", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDefault(page);
  });

  test("issues page loads with board view", async ({ page }) => {
    await expect(page.locator("text=All Issues")).toBeVisible();

    // Board columns should be visible
    await expect(page.locator("text=Backlog")).toBeVisible();
    await expect(page.locator("text=Todo")).toBeVisible();
    await expect(page.locator("text=In Progress")).toBeVisible();
  });

  test("can switch between board and list view", async ({ page }) => {
    await expect(page.locator("text=All Issues")).toBeVisible();

    // Switch to list view
    await page.click("text=List");
    await expect(page.locator("text=All Issues")).toBeVisible();

    // Switch back to board view
    await page.click("text=Board");
    await expect(page.locator("text=Backlog")).toBeVisible();
  });

  test("can create a new issue", async ({ page }) => {
    await page.click("text=New Issue");

    const title = "E2E Created " + Date.now();
    await page.fill('input[placeholder="Issue title..."]', title);
    await page.click("text=Create");

    // New issue should appear on the page
    await expect(page.locator(`text=${title}`).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("can navigate to issue detail page", async ({ page }) => {
    // Wait for issues to load
    await expect(page.locator("text=All Issues")).toBeVisible();

    // Click first issue card that has an anchor tag to issue detail
    const issueLink = page.locator('a[href^="/issues/"]').first();
    await expect(issueLink).toBeVisible({ timeout: 5000 });
    await issueLink.click();

    // Should navigate to issue detail
    await page.waitForURL(/\/issues\/[\w-]+/);

    // Should show Properties panel
    await expect(page.locator("text=Properties")).toBeVisible();
    // Should show breadcrumb link back to Issues
    await expect(
      page.locator("a", { hasText: "Issues" }).first(),
    ).toBeVisible();
  });

  test("can cancel issue creation", async ({ page }) => {
    await page.click("text=New Issue");

    await expect(
      page.locator('input[placeholder="Issue title..."]'),
    ).toBeVisible();

    await page.click("text=Cancel");

    await expect(
      page.locator('input[placeholder="Issue title..."]'),
    ).not.toBeVisible();
    await expect(page.locator("text=New Issue")).toBeVisible();
  });
});
