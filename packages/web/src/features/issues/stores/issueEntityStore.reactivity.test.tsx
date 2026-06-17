import type { IssueListItem } from "@reef/core";
import { act, cleanup, render } from "@testing-library/react";
import { memo } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  purgeAll,
  upsertIssue,
  upsertIssues,
  useIssueEntity,
} from "./issueEntityStore";

/**
 * SC1 lock-in (REEF-098): editing one issue must re-render only that issue's
 * subscriber, not the whole list. The list rows subscribe to a single entity
 * via `useIssueEntity` and are memoized — exactly what this probe reproduces —
 * so a per-entity store update is the granular signal "cost scales with what
 * changed".
 */
const renderCounts: Record<string, number> = {};

const Probe = memo(function Probe({
  vault,
  id,
}: { vault: string; id: string }) {
  const entity = useIssueEntity(vault, id);
  renderCounts[id] = (renderCounts[id] ?? 0) + 1;
  return <div data-testid={`probe-${id}`}>{entity?.title}</div>;
});

function item(id: string, title = id): IssueListItem {
  return {
    id,
    title,
    status: "todo",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "alice",
  } as IssueListItem;
}

beforeEach(() => {
  purgeAll();
  for (const key of Object.keys(renderCounts)) delete renderCounts[key];
});
afterEach(cleanup);

describe("issue entity store — granular reactivity", () => {
  const ids = ["R-1", "R-2", "R-3", "R-4", "R-5"];

  it("re-renders only the edited issue's subscriber, not its siblings", () => {
    upsertIssues(
      "v",
      ids.map((id) => item(id)),
    );
    render(
      <div>
        {ids.map((id) => (
          <Probe key={id} vault="v" id={id} />
        ))}
      </div>,
    );
    for (const id of ids) expect(renderCounts[id]).toBe(1);

    // A non-membership edit to ONE issue: only its subscriber re-renders.
    act(() => upsertIssue("v", item("R-3", "Renamed")));

    expect(renderCounts["R-3"]).toBe(2);
    for (const id of ["R-1", "R-2", "R-4", "R-5"]) {
      expect(renderCounts[id]).toBe(1);
    }
  });

  it("does not re-render any subscriber when a refetch brings identical refs", () => {
    const seed = ids.map((id) => item(id));
    upsertIssues("v", seed);
    render(
      <div>
        {ids.map((id) => (
          <Probe key={id} vault="v" id={id} />
        ))}
      </div>,
    );
    for (const id of ids) expect(renderCounts[id]).toBe(1);

    // Re-normalizing the SAME object refs (TanStack Query structural sharing on
    // an unchanged refetch) must be a no-op for every subscriber.
    act(() => upsertIssues("v", seed));

    for (const id of ids) expect(renderCounts[id]).toBe(1);
  });
});
