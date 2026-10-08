import type { Page, Response } from "@playwright/test";

/** Register before editing/blurring so an earlier autosave cannot satisfy it. */
export function waitForIssueContentSave(
  page: Page,
  issueId: string,
  content: string,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    if (
      new URL(response.url()).pathname !== `/api/issues/${issueId}` ||
      request.method() !== "PATCH"
    ) {
      return false;
    }
    const body = request.postDataJSON() as {
      update?: { content?: unknown };
    };
    return body.update?.content === content;
  });
}
