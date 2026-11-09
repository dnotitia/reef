import assert from "node:assert/strict";
import test from "node:test";
import { reefResource } from "./connect.mjs";

test("canonicalizes Reef deployment URLs and isolated loopback URLs", () => {
  assert.equal(
    reefResource(" https://reef.example/ "),
    "https://reef.example/mcp",
  );
  assert.equal(
    reefResource("https://reef.example/mcp/"),
    "https://reef.example/mcp",
  );
  assert.equal(reefResource("http://[::1]:7333"), "http://[::1]:7333/mcp");
});

test("rejects non-Reef paths, credentials, query, fragments and remote HTTP", () => {
  for (const url of [
    "https://reef.example/path",
    "https://reef.example/a/../mcp",
    "https://user:password@reef.example",
    "https://reef.example/mcp?",
    "https://reef.example#",
    "https://reef.example\\other.example/mcp",
    "file:///var/run/reef",
    "http://reef.example/mcp",
  ]) {
    assert.throws(() => reefResource(url), /Enter the HTTPS Reef/u);
  }
});
