import { describe, expect, it } from "vitest";

import { blockedQuestionSummary } from "./delivery.js";

describe("delivery blocked question", () => {
  it("keeps one question, mutually exclusive choices, recommendation, and impact PM-safe", () => {
    expect(
      blockedQuestionSummary({
        question: "Which test environment should be used?",
        choices: [
          { label: "Existing", description: "Use the existing environment." },
          { label: "New", description: "Create a new environment." },
        ],
        recommendation: "Existing",
        impact: "Existing is available now; New needs provisioning.",
      }),
    ).toBe(
      "Question: Which test environment should be used? Choices: Existing — Use the existing environment.; New — Create a new environment. Recommendation: Existing. Impact: Existing is available now; New needs provisioning.",
    );
  });
});
