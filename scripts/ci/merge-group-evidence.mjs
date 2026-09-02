#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOW_PATH = ".github/workflows/ci.yml";

export function parseQueuePullRequestNumber(headRef) {
  const match = String(headRef ?? "").match(/(?:^|\/)pr-(\d+)-[0-9a-f]+$/i);
  return match ? Number(match[1]) : null;
}

function repositoryTreeSha() {
  return execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
}

function writeDecision(reuse, reason) {
  appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${reuse}\n`);
  console.log(`PR CI reuse: ${reuse} (${reason})`);
}

async function githubJson(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "User-Agent": "reef-merge-group-evidence",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${endpoint}`);
  }
  return response.json();
}

async function resolve() {
  if (process.env.GITHUB_EVENT_NAME !== "merge_group") {
    return writeDecision(false, "not a merge_group event");
  }

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pullRequestNumber = parseQueuePullRequestNumber(
    event.merge_group?.head_ref,
  );
  if (pullRequestNumber === null) {
    return writeDecision(false, "queue head does not identify one PR");
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const pullRequestMergeRef = await githubJson(
    `/repos/${repository}/git/ref/pull/${pullRequestNumber}/merge`,
  );
  const pullRequestMergeSha = pullRequestMergeRef.object.sha;
  const pullRequestMergeCommit = await githubJson(
    `/repos/${repository}/git/commits/${pullRequestMergeSha}`,
  );
  if (pullRequestMergeCommit.tree.sha !== repositoryTreeSha()) {
    return writeDecision(false, "queued tree differs from the tested PR tree");
  }

  const artifactName = `reef-web-production-${pullRequestMergeSha}`;
  const artifacts = await githubJson(
    `/repos/${repository}/actions/artifacts?per_page=100&name=${artifactName}`,
  );
  for (const artifact of artifacts.artifacts ?? []) {
    if (artifact.expired || artifact.name !== artifactName) continue;

    const run = await githubJson(
      `/repos/${repository}/actions/runs/${artifact.workflow_run.id}`,
    );
    if (
      run.event === "pull_request" &&
      run.conclusion === "success" &&
      run.path === WORKFLOW_PATH
    ) {
      return writeDecision(true, `exact tree passed PR CI in run ${run.id}`);
    }
  }

  writeDecision(false, "no successful exact-tree PR CI run");
}

async function main() {
  try {
    await resolve();
  } catch (error) {
    writeDecision(false, `lookup failed; running full CI: ${error.message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
