import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutateAsync = vi.fn();
vi.mock("../hooks/useDevelopmentTargets", () => ({
  useUpdateDevelopmentTarget: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

import { DEFAULT_DEVELOPMENT_PROFILE_CATALOG } from "@reef/core";
import { DevelopmentTargetCard } from "./DevelopmentTargetCard";

const item = {
  repo: { github_id: 1001, owner: "octo", name: "reef" },
  config: {
    github_id: 1001,
    enabled: false,
    recipe_path: ".reef/agent.yml",
    runner_profile: "default",
    permission_profile: ":workspace",
    branch_template: "agent/{issue_id}/{run_id}",
  },
  eligibility: { eligible: false, reason: "target_disabled" as const },
};

function renderCard(canEdit = true) {
  return render(
    <IntlTestProvider>
      <DevelopmentTargetCard
        vault="reef-test"
        item={item}
        catalog={DEFAULT_DEVELOPMENT_PROFILE_CATALOG}
        canEdit={canEdit}
      />
    </IntlTestProvider>,
  );
}

describe("DevelopmentTargetCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders stable repo identity and disables every mutation control for readers", () => {
    renderCard(false);
    expect(screen.getByText("octo/reef")).toBeInTheDocument();
    expect(screen.getByText("GitHub repository ID 1001")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save target" })).toBeDisabled();
  });

  it("keeps the draft after a failed explicit save", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("save failed"));
    renderCard();
    const recipe = screen.getByLabelText("Recipe path");
    fireEvent.change(recipe, { target: { value: "ops/reef-agent.yml" } });
    fireEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(recipe).toHaveValue("ops/reef-agent.yml");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your draft is still here",
    );
  });
});
