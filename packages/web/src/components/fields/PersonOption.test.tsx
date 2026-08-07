import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PersonOption } from "./PersonOption";

afterEach(cleanup);

describe("PersonOption", () => {
  it("prioritizes a distinct display name and keeps the login secondary", () => {
    render(
      <PersonOption
        login="alice"
        name="Alice Kim"
        avatarUrl={null}
        currentLogin="alice"
      />,
    );

    expect(screen.getByText("Alice Kim")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("does not duplicate a login when there is no distinct display name", () => {
    const { rerender } = render(
      <PersonOption
        login="bob"
        name={null}
        avatarUrl={null}
        currentLogin={null}
      />,
    );

    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("@bob")).toBeNull();

    rerender(
      <PersonOption
        login="bob"
        name="bob"
        avatarUrl={null}
        currentLogin={null}
      />,
    );
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("@bob")).toBeNull();
  });
});
