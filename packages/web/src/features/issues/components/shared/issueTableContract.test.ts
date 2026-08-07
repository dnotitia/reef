import { describe, expect, it } from "vitest";
import {
  BACKLOG_COLUMNS,
  ISSUE_LIST_DEFAULT_COLUMNS,
  ISSUE_LIST_OPTIONAL_COLUMNS,
  ISSUE_TABLE_COLUMN_WIDTHS,
  issueTableWidth,
  resolveIssueListColumns,
} from "./issueTableContract";

describe("issue table contract", () => {
  it("keeps the default List preset within the desktop content width", () => {
    expect(ISSUE_LIST_DEFAULT_COLUMNS).toEqual([
      "select",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "due",
      "updated",
    ]);
    expect(issueTableWidth(ISSUE_LIST_DEFAULT_COLUMNS)).toBeLessThanOrEqual(
      992,
    );
    expect(ISSUE_TABLE_COLUMN_WIDTHS.status).toBe(152);
  });

  it("shares common field order and width tokens between List and Backlog", () => {
    expect(BACKLOG_COLUMNS.slice(0, 2)).toEqual(["select", "rank"]);
    const listCommon = ISSUE_LIST_DEFAULT_COLUMNS.filter((column) =>
      ["id", "type", "title", "status", "priority", "assignee"].includes(
        column,
      ),
    );
    const backlogCommon = BACKLOG_COLUMNS.filter((column) =>
      ["id", "type", "title", "status", "priority", "assignee"].includes(
        column,
      ),
    );

    expect(listCommon).toEqual(backlogCommon);
    expect(
      listCommon.map((column) => ISSUE_TABLE_COLUMN_WIDTHS[column]),
    ).toEqual(backlogCommon.map((column) => ISSUE_TABLE_COLUMN_WIDTHS[column]));
  });

  it("resolves optional planning columns without changing their canonical order", () => {
    expect(resolveIssueListColumns([])).toEqual(ISSUE_LIST_DEFAULT_COLUMNS);
    expect(resolveIssueListColumns([...ISSUE_LIST_OPTIONAL_COLUMNS])).toEqual([
      "select",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "start",
      "sprint",
      "milestone",
      "release",
      "due",
      "updated",
    ]);
  });
});
