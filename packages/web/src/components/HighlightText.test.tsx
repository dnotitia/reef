import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightText } from "./HighlightText";

describe("HighlightText", () => {
  it("renders plain text when query is empty", () => {
    const { container } = render(
      <HighlightText text="Fix the login bug" query="" />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("Fix the login bug");
  });

  it("wraps matched substring in <mark>", () => {
    const { container } = render(
      <HighlightText text="Fix the login bug" query="login" />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("login");
    expect(container.textContent).toBe("Fix the login bug");
  });

  it("matches case-insensitively but preserves original case in output", () => {
    const { container } = render(
      <HighlightText text="LOGIN failed" query="login" />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("LOGIN");
  });

  it("wraps every occurrence", () => {
    const { container } = render(
      <HighlightText text="bug bug bug" query="bug" />,
    );
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(3);
    expect(container.textContent).toBe("bug bug bug");
  });

  it("renders plain text when there is no match", () => {
    const { container } = render(
      <HighlightText text="nothing here" query="xyz" />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("nothing here");
  });
});
