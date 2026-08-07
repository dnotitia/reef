import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ISSUE_LIST_DEFAULT_COLUMNS } from "../shared/issueTableContract";
import { IssueListSkeleton } from "./IssueListSkeleton";

afterEach(cleanup);

describe("IssueListSkeleton", () => {
  it("renders the default 8 skeleton rows", () => {
    render(
      <table>
        <tbody>
          <IssueListSkeleton />
        </tbody>
      </table>,
    );
    const rows = screen.getAllByTestId("skeleton-row");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveClass("h-10");
    expect(rows[0]?.querySelector("td")).toHaveClass("h-10", "py-0");
  });

  it("renders the specified number of rows", () => {
    render(
      <table>
        <tbody>
          <IssueListSkeleton rows={3} />
        </tbody>
      </table>,
    );
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);
  });

  it("renders one cell per real table column so the table does not re-layout on hydration (REEF-258)", () => {
    render(
      <table>
        <tbody>
          <IssueListSkeleton rows={1} />
        </tbody>
      </table>,
    );
    const row = screen.getByTestId("skeleton-row");
    const cells = row.querySelectorAll("td");
    // The skeleton receives the same resolved contract as the real header, so
    // hydration cannot change the column count and re-layout the table.
    expect(cells).toHaveLength(ISSUE_LIST_DEFAULT_COLUMNS.length);
    expect(cells.length).toBe(9);
  });
});
