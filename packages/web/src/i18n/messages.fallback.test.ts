// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("./messages/ko.json", () => ({
  default: { settings: { preferences: { language: { heading: "언어" } } } },
}));

import { loadMessages } from "./messages";

describe("loadMessages with a partial locale catalog", () => {
  it("fills missing nested web, field, and error keys from English", () => {
    const messages = loadMessages("ko");
    expect(messages.settings.preferences.language.heading).toBe("언어");
    expect(messages.settings.preferences.language.description).toBe(
      "Choose the language reef's interface uses on this device. The selection persists per device.",
    );
    expect(messages.fields.status.todo).toBe("Todo");
    expect(messages.fields.planning.sprintStatus.active).toBe("Active");
    expect(messages.errors.sessionExpired).toBe(
      "Your session has expired. Please sign in again.",
    );
  });
});
