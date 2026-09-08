import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { SprintRolloverResume } from "@reef/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SprintRolloverResumeNotice } from "./SprintRolloverResumeNotice";

const RESUME = {
  result: {
    source_sprint_id: "source",
    source_sprint: { name: "Sprint 14" },
  },
} as SprintRolloverResume;

function renderNotice(canEdit: boolean) {
  const onOpen = vi.fn();
  render(
    <IntlTestProvider locale="en">
      <SprintRolloverResumeNotice
        resumes={[RESUME]}
        canEdit={canEdit}
        onOpen={onOpen}
      />
    </IntlTestProvider>,
  );
  return onOpen;
}

describe("SprintRolloverResumeNotice", () => {
  it("keeps the resume action disabled for read-only users", async () => {
    const user = userEvent.setup();
    const onOpen = renderNotice(false);
    const action = screen.getByRole("button", {
      name: "Resume Sprint 14 rollover",
    });

    expect(action).toBeDisabled();
    await user.click(action);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens a resume for an editor", async () => {
    const user = userEvent.setup();
    const onOpen = renderNotice(true);
    const action = screen.getByRole("button", {
      name: "Resume Sprint 14 rollover",
    });

    await user.click(action);
    expect(onOpen).toHaveBeenCalledWith(RESUME);
  });
});
