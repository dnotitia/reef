import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { AccessBadge } from "./AccessBadge";

describe("AccessBadge", () => {
  it("labels the editable level with text (not colour alone)", () => {
    render(<AccessBadge level="editable" />);
    expect(screen.getByTestId("access-badge-editable")).toHaveTextContent(
      "You can edit",
    );
  });

  it("labels the view-only level", () => {
    render(<AccessBadge level="view-only" />);
    expect(screen.getByTestId("access-badge-view-only")).toHaveTextContent(
      "View only",
    );
  });

  it("labels the operator-managed level", () => {
    render(<AccessBadge level="managed" />);
    expect(screen.getByTestId("access-badge-managed")).toHaveTextContent(
      "Managed by operator",
    );
  });

  it("uses the active locale for access text", () => {
    render(
      <IntlTestProvider locale="ko">
        <AccessBadge level="editable" />
      </IntlTestProvider>,
    );
    expect(screen.getByTestId("access-badge-editable")).toHaveTextContent(
      "편집 가능",
    );
    expect(screen.getByTestId("access-badge-editable")).not.toHaveTextContent(
      "You can edit",
    );
  });
});
