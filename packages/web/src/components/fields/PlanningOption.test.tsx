import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanningOption } from "./PlanningOption";

afterEach(cleanup);

describe("PlanningOption", () => {
  it("keeps the name primary and the planning status trailing", () => {
    render(
      <IntlTestProvider>
        <PlanningOption kind="sprints" name="Sprint 3" status="active" />
      </IntlTestProvider>,
    );

    expect(screen.getByText("Sprint 3")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
