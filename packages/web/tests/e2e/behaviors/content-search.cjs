const { assert, runClause } = require("./runtime.cjs");

const CONTENT_SEARCH_CLAUSE = "B2:content-search";
const INPUT_SELECTOR = '[data-testid="global-search-input"]';
/**
 * Canonical content-search behavior. The values below are fixture-owned
 * reviewed behavior, not artifact input: the artifact selects this function
 * and cannot redefine its selectors, copy, or expected result.
 */
async function runContentSearchBehavior({
  page,
  context,
  expect,
  workspace = "reef-e2e",
}) {
  return runClause(CONTENT_SEARCH_CLAUSE, async () => {
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder("Search issues...", { exact: true });
    await input.waitFor({ state: "visible", timeout: 15_000 });
    await input.fill("Initial issue Alpha");
    await expect(
      page.getByText("Issue field matches", { exact: true }),
    ).toBeVisible();
    await input.fill("comment-only lighthouse");
    await expect(
      page.getByText("Issue content matches", { exact: true }),
    ).toBeVisible();

    const row = page
      .getByRole("option")
      .filter({ has: page.getByText("REEF-003", { exact: true }) })
      .first();
    await row.waitFor({ state: "visible", timeout: 15_000 });
    await expect(row.getByText("Comment", { exact: true })).toBeVisible();
    await expect(
      row.getByText("comment-only lighthouse", { exact: false }),
    ).toBeVisible();
    await expect(row.locator("mark")).toHaveText("comment-only lighthouse");

    const source = row.getByText("Comment", { exact: true });
    const sourceStyle = await source.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        background: computed.backgroundColor,
        borders: [
          computed.borderTopWidth,
          computed.borderRightWidth,
          computed.borderBottomWidth,
          computed.borderLeftWidth,
        ],
        radius: computed.borderRadius,
      };
    });
    expect(sourceStyle).toEqual({
      background: "rgba(0, 0, 0, 0)",
      borders: ["0px", "0px", "0px", "0px"],
      radius: "0px",
    });

    const snippet = row.getByText("comment-only lighthouse", { exact: false });
    const snippetHandle = await snippet.elementHandle();
    assert(snippetHandle, "content snippet element disappeared");
    const sourceFirst = await source.evaluate(
      (sourceElement, snippetElement) =>
        Boolean(
          sourceElement.compareDocumentPosition(snippetElement) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      snippetHandle,
    );
    await snippetHandle.dispose();
    expect(sourceFirst).toBe(true);

    const accessibleText = await row.ariaSnapshot();
    assertTextOrder(accessibleText, [
      "REEF-003",
      "Backlog issue Gamma",
      "Comment",
      "comment-only lighthouse",
    ]);
    expect(accessibleText).not.toContain("·");

    const anchor = row.locator("a");
    await expect(anchor).toHaveAttribute(
      "href",
      `/workspace/${workspace}/issues/REEF-003`,
    );
    await expect(anchor).not.toHaveAttribute("target");
    expect(await anchor.evaluate((element) => element.tagName)).toBe("A");

    const [modifiedPage] = await Promise.all([
      context.waitForEvent("page"),
      anchor.click({
        modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
      }),
    ]);
    await expect(modifiedPage).toHaveURL(
      new RegExp(`/workspace/${escapeRegExp(workspace)}/issues/REEF-003`),
    );
    await modifiedPage.close();

    const [middlePage] = await Promise.all([
      context.waitForEvent("page"),
      anchor.click({ button: "middle" }),
    ]);
    await expect(middlePage).toHaveURL(
      new RegExp(`/workspace/${escapeRegExp(workspace)}/issues/REEF-003`),
    );
    await middlePage.close();

    await expect(page.locator(INPUT_SELECTOR)).toBeVisible();
    return {
      clause_id: CONTENT_SEARCH_CLAUSE,
      observable:
        "Global search showed the canonical field and comment result, preserved accessible provenance order, and opened the issue through normal and modified clicks.",
      details: {
        issue_id: "REEF-003",
        source: "comment",
        href: `/workspace/${workspace}/issues/REEF-003`,
      },
    };
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&");
}

function assertTextOrder(value, ordered) {
  let cursor = 0;
  for (const part of ordered) {
    const index = value.indexOf(part, cursor);
    assert(
      index >= cursor,
      `accessible option text is missing or misorders ${part}`,
    );
    cursor = index + part.length;
  }
}

module.exports = {
  CONTENT_SEARCH_CLAUSE,
  runContentSearchBehavior,
};
