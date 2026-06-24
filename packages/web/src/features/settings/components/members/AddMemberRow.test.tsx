import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockUseDirectorySearch, mockGrantMutate } = vi.hoisted(() => ({
  mockUseDirectorySearch: vi.fn(),
  mockGrantMutate: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useDirectorySearch", () => ({
  useDirectorySearch: () => mockUseDirectorySearch(),
}));
vi.mock("@/features/settings/hooks/useGrantMember", () => ({
  useGrantMember: () => ({ mutate: mockGrantMutate, isPending: false }),
}));
// Keep the default "writer" role; the Radix Select control is covered elsewhere.
vi.mock("./RoleSelect", () => ({
  RoleSelect: ({ value }: { value: string }) => (
    <button type="button" data-testid="role-select-trigger">
      {value}
    </button>
  ),
  MANAGEABLE_ROLES: ["reader", "writer", "admin"],
}));

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { AddMemberRow } from "./AddMemberRow";

const DIRECTORY = [
  { username: "carol", display_name: "Carol", email: "carol@x.io" },
  { username: "bob", display_name: "Bob", email: null },
];

// bob is already a member; carol is not.
const ROSTER = [{ username: "bob", display_name: "Bob", role: "writer" }];

afterEach(() => vi.clearAllMocks());

describe("AddMemberRow (REEF-179)", () => {
  it("AC2: dims directory users who are already members", () => {
    mockUseDirectorySearch.mockReturnValue({
      data: DIRECTORY,
      isPending: false,
      isError: false,
    });
    render(
      <AddMemberRow vault="reef-acme" roster={ROSTER} currentLogin="dana" />,
      { wrapper: IntlTestProvider },
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a member" }));
    const already = screen.getByTestId("directory-option-bob");
    expect(already).toBeDisabled();
    expect(already).toHaveTextContent("Already a member");
  });

  it("AC2/AC3: selecting a directory user and clicking Add grants the chosen role", () => {
    mockUseDirectorySearch.mockReturnValue({
      data: DIRECTORY,
      isPending: false,
      isError: false,
    });
    const onAdded = vi.fn();
    render(
      <AddMemberRow
        vault="reef-acme"
        roster={ROSTER}
        currentLogin="dana"
        onAdded={onAdded}
      />,
      { wrapper: IntlTestProvider },
    );

    // Add is disabled until a user is picked.
    expect(screen.getByTestId("add-member-submit")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add a member" }));
    fireEvent.click(screen.getByTestId("directory-option-carol"));

    const submit = screen.getByTestId("add-member-submit");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(mockGrantMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "carol",
        role: "writer",
        displayName: "Carol",
      }),
      expect.anything(),
    );
  });
});
