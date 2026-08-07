import { describe, expect, it } from "vitest";
import { parseInvocationArguments } from "./parser.js";

describe("foreground invocation parser", () => {
  it("accepts only the canonical run shape", () => {
    expect(
      parseInvocationArguments([
        "run",
        "reef://reef-test/REEF-101",
        "--config",
        "/tmp/reef-config.json",
      ]),
    ).toEqual({
      workUri: "reef://reef-test/REEF-101",
      configPath: "/tmp/reef-config.json",
    });
  });

  it.each([
    [
      "relative config path",
      ["run", "reef://reef-test/REEF-101", "--config", "config.json"],
    ],
    [
      "escaping config path",
      ["run", "reef://reef-test/REEF-101", "--config", "/tmp/../config.json"],
    ],
    [
      "non-canonical work URI",
      ["run", "reef://reef-test/REEF-101?x=1", "--config", "/tmp/config.json"],
    ],
    ["unknown option", ["run", "reef://reef-test/REEF-101", "--jwt", "secret"]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseInvocationArguments(argv)).toThrowError("usage_invalid");
  });

  it("provides a package-contract help path", () => {
    expect(parseInvocationArguments(["--help"])).toEqual({ help: true });
  });
});
