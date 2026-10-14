// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import {
  preserveCommentBackslashRuns,
  remarkCommentMentions,
} from "./remarkCommentMentions";

describe("remarkCommentMentions renderer", () => {
  it("preserves consecutive authored backslashes in rendered comment text", async () => {
    const body = String.raw`댓글 ' \\ 한글 🧪`;
    const { container } = render(
      <Streamdown mode="static">
        {preserveCommentBackslashRuns(body)}
      </Streamdown>,
    );

    await waitFor(() => {
      expect(container.textContent).toContain(body);
    });
  });

  it("survives the real Streamdown mdast-to-hast renderer", async () => {
    const { container } = render(
      <div className="comment-mention-renderer">
        <Streamdown
          mode="static"
          allowedTags={{ span: ["dataReefMention"] }}
          remarkPlugins={[
            [
              remarkCommentMentions,
              {
                knownUsernames: new Set(["Bob Smith"]),
                cacheFingerprint: "renderer-test",
              },
            ],
          ]}
        >
          {"@{Bob Smith}"}
        </Streamdown>
      </div>,
    );

    await waitFor(() => {
      const mention = container.querySelector("[data-reef-mention]");
      expect(mention).not.toBeNull();
      expect(mention?.tagName).toBe("SPAN");
      expect(mention?.textContent).toBe("@Bob Smith");
      expect(mention?.closest("a")).toBeNull();
    });
  });
});
