import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

  it("each row has 8 cells", () => {
    render(
      <table>
        <tbody>
          <IssueListSkeleton rows={1} />
        </tbody>
      </table>,
    );
    const row = screen.getByTestId("skeleton-row");
    const cells = row.querySelectorAll("td");
    expect(cells).toHaveLength(8);
  });
});
