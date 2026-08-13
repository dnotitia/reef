import type { Collaborator } from "@reef/core";
import { describe, expect, it } from "vitest";
import { orderAssigneeCollaborators } from "./assigneeOptionOrder";

const candidate = (
  login: string,
  name: string | null = login,
): Collaborator => ({ login, name, avatar_url: null });

describe("orderAssigneeCollaborators", () => {
  it("promotes recent logins, removes duplicates, and drops stale logins", () => {
    const candidates = [
      candidate("zara", "Zara"),
      candidate("alice", "Alice"),
      candidate("bob", "Bob"),
    ];

    expect(
      orderAssigneeCollaborators(candidates, ["missing", "bob", "bob"]),
    ).toEqual([candidates[2], candidates[1], candidates[0]]);
  });

  it("keeps the remaining candidates in deterministic display-name/login order", () => {
    const candidates = [
      candidate("z-login", "Same"),
      candidate("a-login", "Same"),
      candidate("beta", "beta"),
      candidate("Alpha", "alpha"),
    ];
    const input = [...candidates];

    expect(orderAssigneeCollaborators(candidates, [])).toEqual([
      candidates[3],
      candidates[2],
      candidates[1],
      candidates[0],
    ]);
    expect(candidates).toEqual(input);
  });
});
