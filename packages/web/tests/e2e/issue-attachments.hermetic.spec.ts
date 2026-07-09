import { Buffer } from "node:buffer";
import { type Page, expect, test } from "@playwright/test";
import { openExistingWorkspace, resetFixture } from "./harness/fixture";

const INLINE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAwCAYAAADuFn/PAAAAs0lEQVR42u3ZsQmAQBAEQHMTezA3sQfLEmxEEGzC0D5sQ9O3g/vgeUSYYMNNbqLlmmlLKUo/P2FK++O1h+mOJUxpP51DmHttw5T2GwAAAAAAAAAAAAAAPgCofeBcv/aBc/3aB871AQAAAAAAAAAAAAD4AsAQs4QBAAAAAAAAAAAA+AcYYpYwAAAAAAAAAAAAAP8AQ8wSBgAAAAAAAAAAAOAfYIhZwgAAAAAAAAAAAAB+D/ACWn8C0ZKjwsMAAAAASUVORK5CYII=",
  "base64",
);
const NOTE_BYTES = Buffer.from("download me", "utf8");
const INLINE_TEXT_BEFORE =
  "Inline image proof: text before the uploaded image.";
const INLINE_TEXT_AFTER = "Inline image proof: text after the uploaded image.";

async function pasteFile(
  page: Page,
  selector: string,
  { name, mimeType, bytes }: { name: string; mimeType: string; bytes: Buffer },
) {
  await page.locator(selector).focus();
  await page.evaluate(
    ({ selector: targetSelector, name, mimeType, bytes }) => {
      const target = document.querySelector(targetSelector);
      if (!target) throw new Error(`Missing paste target: ${targetSelector}`);
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(bytes)], name, { type: mimeType }),
      );
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: transfer });
      target.dispatchEvent(event);
    },
    { selector, name, mimeType, bytes: [...bytes] },
  );
}

test.describe("Hermetic issue attachments (REEF-349)", () => {
  test.beforeEach(async ({ context, request }) => {
    await context.clearCookies();
    await resetFixture(request, "configured");
  });

  test("uploads pasted files, renders inline images, and downloads stored bytes", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    await page.locator('[data-testid="markdown-source-toggle"] button').click();
    const source = page.locator('[data-testid="markdown-source-textarea"]');
    await pasteFile(page, '[data-testid="markdown-source-textarea"]', {
      name: "reef-inline.png",
      mimeType: "image/png",
      bytes: INLINE_PNG,
    });

    await expect(source).toHaveValue(
      /!\[reef-inline\.png\]\(akb:\/\/reef-e2e\/issues\/reef-001\/attachments\/file\/file-1\)/,
    );
    const inlineMarkdown = await source.inputValue();
    const imageMarkdown = inlineMarkdown.match(
      /!\[reef-inline\.png\]\(akb:\/\/reef-e2e\/issues\/reef-001\/attachments\/file\/file-1\)/,
    )?.[0];
    if (!imageMarkdown) throw new Error("Missing inline image markdown");
    await source.fill(
      `${INLINE_TEXT_BEFORE}\n\n${imageMarkdown}\n\n${INLINE_TEXT_AFTER}`,
    );
    await expect(source).toHaveValue(
      new RegExp(`${INLINE_TEXT_BEFORE}[\\s\\S]+${INLINE_TEXT_AFTER}`),
    );
    await page.locator('[data-testid="markdown-source-toggle"] button').click();

    const bodyProof = page
      .locator('[data-testid="markdown-editor-body-frame"]')
      .first();
    const inlineImage = page.locator('img[alt="reef-inline.png"]');
    await expect(bodyProof.getByText(INLINE_TEXT_BEFORE)).toBeVisible();
    await expect(inlineImage).toBeVisible();
    await expect(bodyProof.getByText(INLINE_TEXT_AFTER)).toBeVisible();
    await expect(inlineImage).toHaveAttribute(
      "src",
      /\/api\/issues\/REEF-001\/attachments\/file/,
    );
    const imageSrc = await inlineImage.getAttribute("src");
    if (!imageSrc) throw new Error("Inline image is missing a src");
    const imageResponse = await page.request.get(
      new URL(imageSrc, page.url()).toString(),
    );
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["content-type"]).toContain("image/png");
    expect(await imageResponse.body()).toEqual(INLINE_PNG);
    await bodyProof.screenshot({
      path: "test-results/reef-349-inline-image-context.png",
    });

    const composer = page.getByLabel("Add a comment");
    await composer.scrollIntoViewIfNeeded();
    await pasteFile(page, 'textarea[aria-label="Add a comment"]', {
      name: "notes.txt",
      mimeType: "text/plain",
      bytes: NOTE_BYTES,
    });

    const attachmentCard = page.locator("article", { hasText: "notes.txt" });
    await expect(attachmentCard).toBeVisible();
    const downloadHref = await attachmentCard
      .getByRole("link", { name: "Download" })
      .getAttribute("href");
    if (!downloadHref) throw new Error("Attachment download link is missing");
    const downloadResponse = await page.request.get(
      new URL(downloadHref, page.url()).toString(),
    );
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()["content-type"]).toContain("text/plain");
    expect(await downloadResponse.body()).toEqual(NOTE_BYTES);

    await attachmentCard.screenshot({
      path: "test-results/reef-349-attachment-card.png",
    });
  });

  test("inserts uploaded image markdown from the editor toolbar file picker (REEF-401)", async ({
    page,
  }) => {
    await openExistingWorkspace(page);
    await page.goto("/workspace/reef-e2e/issues/REEF-001");
    await expect(page.locator('[data-testid="issue-detail"]')).toBeVisible();

    const attachButton = page.getByTitle("Attach file");
    await expect(attachButton).toBeVisible();
    await expect(attachButton).toBeEnabled();

    const chooserPromise = page.waitForEvent("filechooser");
    await attachButton.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "reef-toolbar.png",
      mimeType: "image/png",
      buffer: INLINE_PNG,
    });

    await page.locator('[data-testid="markdown-source-toggle"] button').click();
    const source = page.locator('[data-testid="markdown-source-textarea"]');
    await expect(source).toHaveValue(
      /!\[reef-toolbar\.png\]\(akb:\/\/reef-e2e\/issues\/reef-001\/attachments\/file\/file-1\)/,
    );
    await expect(attachButton).toBeEnabled();
    await page.locator('[data-testid="markdown-editor"]').screenshot({
      path: "test-results/reef-401-toolbar-attachment-live-proof.png",
    });
  });
});
