import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  mockUseVaultRoster,
  mockUseCurrentUserLogin,
  mockGrantMutate,
  mockRevokeMutate,
} = vi.hoisted(() => ({
  mockUseVaultRoster: vi.fn(),
  mockUseCurrentUserLogin: vi.fn(),
  mockGrantMutate: vi.fn(),
  mockRevokeMutate: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useVaultRoster", () => ({
  useVaultRoster: () => mockUseVaultRoster(),
  vaultRosterKey: (vault: string) => ["vault-roster", vault],
}));
vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => mockUseCurrentUserLogin(),
}));
vi.mock("@/features/settings/hooks/useGrantMember", () => ({
  useGrantMember: () => ({ mutate: mockGrantMutate, isPending: false }),
}));
vi.mock("@/features/settings/hooks/useRevokeMember", () => ({
  useRevokeMember: () => ({ mutate: mockRevokeMutate, isPending: false }),
}));
vi.mock("@/features/settings/hooks/useDirectorySearch", () => ({
  useDirectorySearch: () => ({ data: [], isPending: false, isError: false }),
}));
// Radix Select needs pointer APIs jsdom lacks; the role control's own behavior
// is covered elsewhere, so stub it to a plain trigger here.
vi.mock("./RoleSelect", () => ({
  RoleSelect: ({ value, name }: { value: string; name: string }) => (
    <button
      type="button"
      data-testid="role-select-trigger"
      aria-label={`Role for ${name}`}
    >
      {value}
    </button>
  ),
  MANAGEABLE_ROLES: ["reader", "writer", "admin"],
}));

import { MembersSection } from "./MembersSection";

const ROSTER = [
  { username: "alice", display_name: "Alice", role: "owner" },
  { username: "dana", display_name: "Dana", role: "admin" },
  { username: "sam", display_name: "Sam", role: "writer" },
  { username: "min", display_name: "Min", role: "reader" },
];

function rosterLoaded() {
  mockUseVaultRoster.mockReturnValue({
    data: ROSTER,
    isPending: false,
    isError: false,
    error: null,
  });
}

afterEach(() => vi.clearAllMocks());

describe("MembersSection (REEF-179)", () => {
  it("AC1: lists every member with @login and role", () => {
    rosterLoaded();
    mockUseCurrentUserLogin.mockReturnValue("dana");
    render(<MembersSection vault="reef-acme" canManage={true} />);

    for (const u of ["alice", "dana", "sam", "min"]) {
      expect(screen.getByTestId(`member-row-${u}`)).toBeInTheDocument();
    }
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByTestId("member-role-alice")).toHaveTextContent("owner");
  });

  it("AC3/AC5 (admin): other members are manageable; owner and self are read-only", () => {
    rosterLoaded();
    mockUseCurrentUserLogin.mockReturnValue("dana"); // the admin is signed in
    render(<MembersSection vault="reef-acme" canManage={true} />);

    // sam (writer, not self) → editable role + remove
    const sam = within(screen.getByTestId("member-row-sam"));
    expect(sam.getByTestId("role-select-trigger")).toBeInTheDocument();
    expect(sam.getByTestId("member-remove-sam")).toBeInTheDocument();

    // alice (owner) → role badge, no remove
    const alice = within(screen.getByTestId("member-row-alice"));
    expect(alice.getByTestId("member-role-alice")).toBeInTheDocument();
    expect(alice.queryByTestId("member-remove-alice")).toBeNull();

    // dana (self) → "You", no remove
    const dana = within(screen.getByTestId("member-row-dana"));
    expect(dana.getByText("You")).toBeInTheDocument();
    expect(dana.queryByTestId("member-remove-dana")).toBeNull();

    // admin sees the add form
    expect(screen.getByTestId("add-member-row")).toBeInTheDocument();
  });

  it("AC5 (reader): no add form, no controls — roster is read-only", () => {
    rosterLoaded();
    mockUseCurrentUserLogin.mockReturnValue("min");
    render(<MembersSection vault="reef-acme" canManage={false} />);

    expect(screen.queryByTestId("add-member-row")).toBeNull();
    expect(screen.queryByTestId("role-select-trigger")).toBeNull();
    expect(screen.queryByTestId("member-remove-sam")).toBeNull();
    expect(screen.getByTestId("member-role-sam")).toHaveTextContent("writer");
  });

  it("keeps every row read-only until the signed-in identity resolves (no self-management window)", () => {
    rosterLoaded();
    mockUseCurrentUserLogin.mockReturnValue(null); // /auth/me not resolved yet
    render(<MembersSection vault="reef-acme" canManage={true} />);

    // Admin can already manage per the role query, but with self unknown no
    // member row exposes a role control or remove button. (Scope to the row —
    // the add form's own role picker lives outside the list.)
    const sam = within(screen.getByTestId("member-row-sam"));
    expect(sam.queryByTestId("role-select-trigger")).toBeNull();
    expect(sam.queryByTestId("member-remove-sam")).toBeNull();
    expect(sam.getByTestId("member-role-sam")).toHaveTextContent("writer");
    // The add form is independent of self identity and stays available.
    expect(screen.getByTestId("add-member-row")).toBeInTheDocument();
  });

  it("AC4: removing a member opens a confirm dialog and revokes on confirm", () => {
    rosterLoaded();
    mockUseCurrentUserLogin.mockReturnValue("dana");
    render(<MembersSection vault="reef-acme" canManage={true} />);

    fireEvent.click(screen.getByTestId("member-remove-sam"));
    expect(screen.getByTestId("remove-member-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("remove-member-confirm"));
    expect(mockRevokeMutate).toHaveBeenCalledWith("sam", expect.anything());
  });

  it("renders skeletons while the roster loads", () => {
    mockUseVaultRoster.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    });
    mockUseCurrentUserLogin.mockReturnValue(null);
    render(<MembersSection vault="reef-acme" canManage={true} />);
    expect(screen.getByTestId("members-loading")).toBeInTheDocument();
  });

  it("AC6: surfaces a roster load error", () => {
    mockUseVaultRoster.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("boom"),
    });
    mockUseCurrentUserLogin.mockReturnValue(null);
    render(<MembersSection vault="reef-acme" canManage={true} />);
    expect(screen.getByTestId("members-error")).toHaveTextContent("boom");
  });
});
