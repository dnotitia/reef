import assert from "node:assert/strict";
import test from "node:test";

import { parseQueuePullRequestNumber } from "./merge-group-evidence.mjs";

test("extracts a PR number from a GitHub merge queue ref", () => {
  assert.equal(
    parseQueuePullRequestNumber(
      "refs/heads/gh-readonly-queue/main/pr-421-eb80bd5b1257eab1d2a535c5ba2cadecabdee95d",
    ),
    421,
  );
  assert.equal(
    parseQueuePullRequestNumber(
      "gh-readonly-queue/main/pr-7-eb80bd5b1257eab1d2a535c5ba2cadecabdee95d",
    ),
    7,
  );
});

test("rejects refs that do not identify one queued PR", () => {
  assert.equal(parseQueuePullRequestNumber("refs/heads/main"), null);
  assert.equal(
    parseQueuePullRequestNumber("gh-readonly-queue/main/pr-7-not-a-sha"),
    null,
  );
});
