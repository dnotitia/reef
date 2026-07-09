import { expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

// REEF-368: the linked-document "open in akb" backlink must be driven by the
// akb web base the SERVER reads at request time (AKB_WEB_URL), handed to the
// client through AkbWebUrlProvider — not a build-time `NEXT_PUBLIC_*` inline
// that vanished from a deployed bundle whose build lacked the var. The hermetic
// web server sets AKB_WEB_URL=https://akb.e2e.test (playwright.config.ts) and
// the akb mock gives REEF-001 one `references` edge, so this drives the real
// reef-web runtime and asserts the open link's href is built from that runtime
// value end to end.
const AKB_WEB_BASE = "https://akb.e2e.test";
const REFERENCE_URI = "akb://reef-e2e/coll/docs/doc/spec-overview.md";
// buildAkbDocumentUrl: base + /vault/<vault>/doc/<encodeURIComponent(coll/slug)>.
const EXPECTED_HREF = `${AKB_WEB_BASE}/vault/reef-e2e/doc/${encodeURIComponent(
  "docs/spec-overview.md",
)}`;

test.describe("Hermetic linked-document backlink (REEF-368)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("renders the akb open link with an href built from the runtime AKB_WEB_URL", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    // The linked document card (fed by the mock `references` edge) renders.
    await expect(page.getByText("Spec overview")).toBeVisible();

    // Its "open in akb" backlink points at the akb web app, with the URL built
    // from the value the SERVER read from AKB_WEB_URL at request time. Had the
    // old build-time `NEXT_PUBLIC_*` read survived, this image (built without
    // the var) would render no open link at all.
    const openLink = page.getByRole("link", { name: "Open document in akb" });
    await expect(openLink).toHaveAttribute("href", EXPECTED_HREF);
  });

  test("auto-links akb document URIs in the issue body and opens them with AKB_WEB_URL", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const source = page.getByTestId("markdown-source-textarea");
    const resolved = `See [Spec overview](${REFERENCE_URI})`;
    const resolveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/documents/resolve") &&
        response.status() === 200,
    );

    await source.fill(`See ${REFERENCE_URI}`);
    await resolveResponse;
    await expect(source).toHaveValue(resolved);

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/issues/REEF-001") &&
        response.request().method() === "PATCH" &&
        response.status() === 200,
    );
    await page.getByTestId("issue-title-input").click();
    await saveResponse;

    await page
      .getByTestId("markdown-source-toggle")
      .getByRole("button")
      .click();
    const bodyLink = page
      .locator(".reef-markdown-editor a", { hasText: "Spec overview" })
      .first();
    await expect(bodyLink).toHaveAttribute("href", EXPECTED_HREF);
  });
});
