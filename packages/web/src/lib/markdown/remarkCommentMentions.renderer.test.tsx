// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import { remarkCommentMentions } from "./remarkCommentMentions";

describe("remarkCommentMentions renderer", () => {
  it("survives the real Streamdown mdast-to-hast renderer", async () => {
    const { container } = render(
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
      </Streamdown>,
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
