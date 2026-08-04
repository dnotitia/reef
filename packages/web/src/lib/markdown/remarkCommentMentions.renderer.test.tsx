// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { remarkCommentMentions } from "./remarkCommentMentions";

describe("remarkCommentMentions renderer", () => {
  it("survives the real Streamdown mdast-to-hast renderer", async () => {
    const style = document.createElement("style");
    // jsdom cannot parse Tailwind v4's @theme/@source directives. Install the
    // equivalent compiled selector here and keep the source-level selector
    // contract covered by globals.test.ts.
    style.textContent =
      ".comment-mention-renderer [data-reef-mention] { color: rgb(20, 184, 166); font-weight: 500; }";
    document.head.append(style);
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
      expect(getComputedStyle(mention as Element).fontWeight).toBe("500");
      expect(getComputedStyle(mention as Element).color).not.toBe("");
    });
    style.remove();
  });
});
