import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  LLMConfigSchema,
  MonitoredRepoSchema,
  PROJECT_PREFIX_PATTERN,
} from "./config";

const validLLMConfig = {
  api_key: "sk-test-key",
  base_url: "https://api.openai.com/v1",
  model: "gpt-4o",
};

const validMonitoredRepo = {
  github_id: 123456,
  owner: "acme-corp",
  name: "backend-service",
};

const validConfig = {
  project_prefix: "REEF",
  monitored_repos: [validMonitoredRepo],
};

describe("LLMConfigSchema", () => {
  it("parses a valid LLM config", () => {
    const result = LLMConfigSchema.safeParse(validLLMConfig);
    expect(result.success).toBe(true);
  });

  it("accepts http://localhost base_url (local dev)", () => {
    const result = LLMConfigSchema.safeParse({
      ...validLLMConfig,
      base_url: "http://localhost:11434",
    });
    expect(result.success).toBe(true);
  });

  it("accepts http://localhost with path (Ollama)", () => {
    const result = LLMConfigSchema.safeParse({
      ...validLLMConfig,
      base_url: "http://localhost:11434/v1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects file:// base_url", () => {
    const result = LLMConfigSchema.safeParse({
      ...validLLMConfig,
      base_url: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects javascript: base_url", () => {
    const result = LLMConfigSchema.safeParse({
      ...validLLMConfig,
      base_url: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty api_key", () => {
    const result = LLMConfigSchema.safeParse({
      ...validLLMConfig,
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty model", () => {
    const result = LLMConfigSchema.safeParse({ ...validLLMConfig, model: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing api_key", () => {
    const { api_key: _api_key, ...rest } = validLLMConfig;
    const result = LLMConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("MonitoredRepoSchema", () => {
  it("parses a valid monitored repo (without description)", () => {
    const result = MonitoredRepoSchema.safeParse(validMonitoredRepo);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github_id).toBe(123456);
      expect(result.data.owner).toBe("acme-corp");
      expect(result.data.name).toBe("backend-service");
      expect(result.data.description).toBeUndefined();
    }
  });

  it("parses a valid monitored repo (with description)", () => {
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      description: "Main backend service",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Main backend service");
    }
  });

  it("rejects missing github_id", () => {
    const { github_id: _id, ...rest } = validMonitoredRepo;
    const result = MonitoredRepoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer github_id", () => {
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      github_id: 12.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero or negative github_id", () => {
    const zero = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      github_id: 0,
    });
    expect(zero.success).toBe(false);
    const negative = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      github_id: -1,
    });
    expect(negative.success).toBe(false);
  });

  it("rejects missing owner", () => {
    const { owner: _owner, ...rest } = validMonitoredRepo;
    const result = MonitoredRepoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _name, ...rest } = validMonitoredRepo;
    const result = MonitoredRepoSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty owner", () => {
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      owner: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects owner with invalid characters", () => {
    const space = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      owner: "acme corp",
    });
    expect(space.success).toBe(false);
    const slash = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      owner: "acme/corp",
    });
    expect(slash.success).toBe(false);
    const quote = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      owner: "acme'corp",
    });
    expect(quote.success).toBe(false);
  });

  it("rejects name with invalid characters", () => {
    const space = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      name: "backend service",
    });
    expect(space.success).toBe(false);
    const semicolon = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      name: "backend;service",
    });
    expect(semicolon.success).toBe(false);
  });

  it("accepts owner/name with periods, underscores, hyphens", () => {
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      owner: "acme.org_team-1",
      name: "front-end.app_v2",
    });
    expect(result.success).toBe(true);
  });

  it("rejects owner/name over 100 characters", () => {
    const longName = "a".repeat(101);
    const result = MonitoredRepoSchema.safeParse({
      ...validMonitoredRepo,
      name: longName,
    });
    expect(result.success).toBe(false);
  });
});

describe("ConfigSchema (team-shared _reef/config.md in akb vault)", () => {
  it("parses a valid config", () => {
    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_prefix).toBe("REEF");
      expect(result.data.monitored_repos).toHaveLength(1);
    }
  });

  it("defaults monitored_repos to [] when absent", () => {
    const result = ConfigSchema.safeParse({ project_prefix: "REEF" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.monitored_repos).toEqual([]);
    }
  });

  it("parses config with multiple monitored repos", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      monitored_repos: [
        validMonitoredRepo,
        {
          github_id: 789012,
          owner: "acme-corp",
          name: "frontend-app",
          description: "React app",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.monitored_repos).toHaveLength(2);
    }
  });

  it("rejects config with invalid monitored_repos entry", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      monitored_repos: [{ owner: "acme-corp" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing project_prefix", () => {
    const result = ConfigSchema.safeParse({ monitored_repos: [] });
    expect(result.success).toBe(false);
  });

  it("rejects empty project_prefix", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      project_prefix: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects lowercase project_prefix", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      project_prefix: "reef",
    });
    expect(result.success).toBe(false);
  });

  it("rejects project_prefix with digits", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      project_prefix: "REEF2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects project_prefix with hyphen", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      project_prefix: "RE-EF",
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown extra fields (forward-compat extension slots)", () => {
    const result = ConfigSchema.safeParse({
      ...validConfig,
      future_field: "ignored",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(
        expect.arrayContaining(["project_prefix", "monitored_repos"]),
      );
    }
  });
});

describe("PROJECT_PREFIX_PATTERN", () => {
  it("matches uppercase A-Z only", () => {
    expect(PROJECT_PREFIX_PATTERN.test("REEF")).toBe(true);
    expect(PROJECT_PREFIX_PATTERN.test("A")).toBe(true);
    expect(PROJECT_PREFIX_PATTERN.test("PROJECT")).toBe(true);
  });

  it("rejects digits, hyphens, lowercase, empty", () => {
    expect(PROJECT_PREFIX_PATTERN.test("reef")).toBe(false);
    expect(PROJECT_PREFIX_PATTERN.test("REEF1")).toBe(false);
    expect(PROJECT_PREFIX_PATTERN.test("RE-EF")).toBe(false);
    expect(PROJECT_PREFIX_PATTERN.test("")).toBe(false);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("passes ConfigSchema validation", () => {
    const result = ConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });
});
