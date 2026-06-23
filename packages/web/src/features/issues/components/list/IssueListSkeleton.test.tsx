import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IssueListSkeleton } from "./IssueListSkeleton";
import { COLUMN_LABELS } from "./issueListColumns";

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
    // The skeleton's column count is derived from COLUMN_LABELS, the same
    // source IssueListTable's header uses, so the two do not drift (the bug
    // was a hard-coded 8 against a 13-column header).
    expect(cells).toHaveLength(COLUMN_LABELS.length);
    expect(cells.length).toBe(13);
  });
});
