import type { ChatDocumentCitation } from "@/features/ai/chat/chatTypes";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ChatCitations } from "./ChatCitations";

function render(ui: ReactElement) {
  return rtlRender(<IntlTestProvider>{ui}</IntlTestProvider>);
}

describe("ChatCitations", () => {
  it("renders nothing when there are no citations", () => {
    render(<ChatCitations citations={[]} />);
    expect(screen.queryByTestId("chat-citations")).toBeNull();
  });

  it("renders the sources heading, a card, its breadcrumb, and a copy action", () => {
    const citation: ChatDocumentCitation = {
      uri: "akb://reef-e2e/coll/decisions/doc/auth.md",
      title: "Auth design",
      collection: "decisions",
      docType: "decision",
    };
    render(<ChatCitations citations={[citation]} />);

    expect(screen.getByTestId("chat-citations")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Auth design")).toBeInTheDocument();
    expect(screen.getByText("reef-e2e · decisions")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy akb URI" }),
    ).toBeInTheDocument();
  });
});
