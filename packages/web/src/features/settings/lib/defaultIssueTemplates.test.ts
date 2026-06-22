// @vitest-environment node
import { TemplateSchema } from "@reef/core";
import { ISSUE_TYPE_OPTIONS } from "@reef/core/fields";
import { describe, expect, it } from "vitest";
import { DEFAULT_ISSUE_TEMPLATES } from "./defaultIssueTemplates";

const byName = new Map(DEFAULT_ISSUE_TEMPLATES.map((t) => [t.name, t]));

describe("DEFAULT_ISSUE_TEMPLATES", () => {
  // AC3: every shipped default must satisfy the template contract the seed
  // path (writeTemplate) and TemplatePicker validate against.
  it("each template validates against TemplateSchema", () => {
    for (const template of DEFAULT_ISSUE_TEMPLATES) {
      expect(() => TemplateSchema.parse(template)).not.toThrow();
    }
  });

  // AC1: the set is aligned 1:1 to reef's canonical IssueTypeEnum.
  it("names are exactly the six canonical issue types", () => {
    expect([...byName.keys()].sort()).toEqual([...ISSUE_TYPE_OPTIONS].sort());
  });

  it("drops the legacy non-type templates feature and tech-debt", () => {
    expect(byName.has("feature")).toBe(false);
    expect(byName.has("tech-debt")).toBe(false);
  });

  // AC1: default_labels seed the matching kind label (task carries none — it is
  // a weak label axis and reef does not tag plain tasks).
  it("seeds the kind label via default_labels", () => {
    expect(byName.get("epic")?.default_labels).toEqual(["epic"]);
    expect(byName.get("story")?.default_labels).toEqual(["story"]);
    expect(byName.get("bug")?.default_labels).toEqual(["bug"]);
    expect(byName.get("spike")?.default_labels).toEqual(["spike"]);
    expect(byName.get("chore")?.default_labels).toEqual(["chore"]);
    expect(byName.get("task")?.default_labels).toEqual([]);
  });

  // AC2: Given/When/Then lands only on the behavior-bearing types.
  it.each(["story", "bug"])(
    "%s carries a Given/When/Then acceptance-criteria section",
    (name) => {
      const body = byName.get(name)?.body ?? "";
      expect(body).toContain("## Acceptance criteria");
      expect(body).toMatch(/Given .*when .*then/i);
    },
  );

  // AC2: the other four deliberately do NOT carry a Given/When/Then scenario;
  // each encodes a done-definition that fits its kind instead.
  it.each([
    ["epic", "## Success criteria"],
    ["task", "## Done when"],
    ["spike", "## Done when"],
    ["chore", "## Done when"],
  ])("%s encodes a non-Gherkin done section (%s)", (name, heading) => {
    const body = byName.get(name)?.body ?? "";
    expect(body).toContain(heading);
    expect(body).not.toMatch(/Given .*when .*then/i);
  });
});
