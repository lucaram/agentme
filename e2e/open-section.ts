import type { Page } from "@playwright/test";

/**
 * My Business sections open one at a time: open the one a step needs (if it isn't already).
 * About, Details, Website & documents and Q&A are tabs of "What your agent knows": for those,
 * that section is opened and the tab chosen. Returns the section (or tab panel).
 */
export async function openSection(page: Page, testId: string) {
  const tab = page.getByTestId(`${testId}-tab`);
  if (await tab.count()) {
    const knows = page.getByTestId("fold-knows");
    if ((await knows.getAttribute("open")) === null) await knows.locator("summary").first().click();
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    return page.getByTestId(testId);
  }
  const fold = page.getByTestId(testId);
  if ((await fold.getAttribute("open")) === null) await fold.locator("summary").first().click();
  return fold;
}
