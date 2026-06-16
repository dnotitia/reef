import { describe, expect, it } from "vitest";
import type { ProjectStateUserPromptRequest } from "../../schemas/ai/prompts";
import {
  buildProjectStateSystemPrompt,
  buildProjectStateUserPrompt,
} from "./projectState";

describe("buildProjectStateSystemPrompt", () => {
  it("without tools: contains 'using ONLY the provided data'", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).toContain("using ONLY the provided data");
  });

  it("without tools: does NOT contain TOOL USAGE RULES", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).not.toContain("TOOL USAGE RULES");
  });

  it("with hasDevTools: contains TOOL USAGE RULES", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: true,
      monitoredRepos: [],
    });
    expect(prompt).toContain("TOOL USAGE RULES");
  });

  it("with hasDevTools: contains dev tool names", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: true,
      monitoredRepos: [],
    });
    expect(prompt).toContain("dev_read_file");
    expect(prompt).toContain("dev_list_files");
    expect(prompt).toContain("dev_search_code");
    expect(prompt).toContain("dev_list_commits");
  });

  it("with hasDevTools and monitoredRepos: includes repo owner and name", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: true,
      monitoredRepos: [
        { owner: "myorg", name: "myapp", defaultBranch: "develop" },
      ],
    });
    expect(prompt).toContain("AVAILABLE MONITORED REPOS");
    expect(prompt).toContain("myorg");
    expect(prompt).toContain("myapp");
    expect(prompt).toContain("develop");
  });

  it("with hasLocalTools: contains local tool names", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: true,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("list_files");
    expect(prompt).toContain("search_content");
    expect(prompt).toContain("TOOL USAGE RULES");
  });

  it("with both tools: contains all tool types", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: true,
      hasDevTools: true,
      monitoredRepos: [],
    });
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("dev_read_file");
    expect(prompt).toContain("TOOL USAGE RULES");
  });

  it("contains ANTI-FABRICATION RULES", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).toContain("ANTI-FABRICATION RULES");
  });

  it("contains JSON schema fields", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).toContain("answer");
    expect(prompt).toContain("referenced_issue_ids");
  });

  it("contains EXAMPLE RESPONSE", () => {
    const prompt = buildProjectStateSystemPrompt({
      hasLocalTools: false,
      hasDevTools: false,
      monitoredRepos: [],
    });
    expect(prompt).toContain("EXAMPLE RESPONSE");
  });
});

describe("buildProjectStateUserPrompt", () => {
  const baseReq: ProjectStateUserPromptRequest = {
    question: "What's blocking the payment module?",
    issueContexts: [
      {
        id: "REEF-042",
        title: "Payment module refactoring",
        status: "todo",
        assigned_to: "minsu",
        depends_on: ["REEF-037"],
        blocks: [],
        lastStatusChange: "2026-04-10",
      },
      {
        id: "REEF-037",
        title: "Authentication module",
        status: "in_progress",
        assigned_to: "jieun",
        depends_on: [],
        blocks: ["REEF-042"],
        lastStatusChange: "2026-04-08",
      },
    ],
    hasTools: false,
  };

  it("contains the PM question", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("What's blocking the payment module?");
  });

  it("sorts backlog after open but before done/closed so it survives the cap (REEF-109)", () => {
    const prompt = buildProjectStateUserPrompt({
      question: "What's in the backlog?",
      issueContexts: [
        {
          id: "REEF-DONE",
          title: "Finished",
          status: "done",
          depends_on: [],
          blocks: [],
        },
        {
          id: "REEF-BACKLOG",
          title: "Deferred",
          status: "backlog",
          depends_on: [],
          blocks: [],
        },
        {
          id: "REEF-OPEN",
          title: "Queued",
          status: "todo",
          depends_on: [],
          blocks: [],
        },
      ],
      hasTools: false,
    });
    const openAt = prompt.indexOf("REEF-OPEN");
    const backlogAt = prompt.indexOf("REEF-BACKLOG");
    const doneAt = prompt.indexOf("REEF-DONE");
    expect(openAt).toBeLessThan(backlogAt);
    expect(backlogAt).toBeLessThan(doneAt);
  });

  it("contains issue IDs", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("REEF-042");
    expect(prompt).toContain("REEF-037");
  });

  it("contains issue titles", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("Payment module refactoring");
    expect(prompt).toContain("Authentication module");
  });

  it("contains assignees", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("minsu");
    expect(prompt).toContain("jieun");
  });

  it("contains blocks field", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("blocks");
  });

  it("contains last_status_change field", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    expect(prompt).toContain("last_status_change");
  });

  it("without tools: says 'using ONLY the data above'", () => {
    const prompt = buildProjectStateUserPrompt({ ...baseReq, hasTools: false });
    expect(prompt).toContain("using ONLY the data above");
  });

  it("with tools: says 'tools described in your instructions'", () => {
    const prompt = buildProjectStateUserPrompt({ ...baseReq, hasTools: true });
    expect(prompt).toContain("tools described in your instructions");
  });

  it("with tools: does NOT say 'using ONLY'", () => {
    const prompt = buildProjectStateUserPrompt({ ...baseReq, hasTools: true });
    expect(prompt).not.toContain("using ONLY");
  });

  it("with tools: still contains issue data", () => {
    const prompt = buildProjectStateUserPrompt({ ...baseReq, hasTools: true });
    expect(prompt).toContain("REEF-042");
  });

  it("with tools: still contains JSON instruction", () => {
    const prompt = buildProjectStateUserPrompt({ ...baseReq, hasTools: true });
    expect(prompt).toContain("Return only the JSON object");
  });

  it("sorts issues: in_progress before open", () => {
    const prompt = buildProjectStateUserPrompt(baseReq);
    const indexInProgress = prompt.indexOf("REEF-037"); // in_progress
    const indexOpen = prompt.indexOf("REEF-042"); // open
    expect(indexInProgress).toBeLessThan(indexOpen);
  });
});
