import { Command, CommandInput, CommandList } from "@/components/ui/command";
import type {
  BoundAppAction,
  CommandRegistry,
} from "@/features/commands/hooks/useCommandRegistry";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandMode } from "./CommandMode";

function registryWith(actions: ReadonlyArray<BoundAppAction>) {
  return {
    paletteActions: () => actions,
    getFreshIssue: () => undefined,
  } as unknown as CommandRegistry;
}

function renderMode({
  actions = [],
  pages = ["root"],
  query = "",
  target = null,
  onExecute = vi.fn(),
}: {
  actions?: ReadonlyArray<BoundAppAction>;
  pages?: Array<
    | "root"
    | "navigation"
    | "view"
    | "theme"
    | "locale"
    | "status"
    | "assignee"
    | "priority"
  >;
  query?: string;
  target?: {
    issueId: string;
    title: string;
    source: "detail" | "list" | "board";
  } | null;
  onExecute?: ReturnType<typeof vi.fn>;
}) {
  return render(
    <IntlTestProvider>
      <Command>
        <CommandInput value={query} readOnly />
        <CommandList>
          <CommandMode
            state={{ pages, query }}
            vault="reef-acme"
            target={target}
            registry={registryWith(actions)}
            onPushPage={vi.fn()}
            onExecute={onExecute}
          />
        </CommandList>
      </Command>
    </IntlTestProvider>,
  );
}

describe("CommandMode", () => {
  it("shows single-issue pages with the resolved target and hides them without context", () => {
    const { rerender } = renderMode({
      target: {
        issueId: "REEF-042",
        title: "Command target",
        source: "detail",
      },
    });

    expect(
      screen
        .getAllByTestId("command-page-entry")
        .filter((entry) => entry.textContent?.includes("REEF-042")),
    ).toHaveLength(3);

    rerender(
      <IntlTestProvider>
        <Command>
          <CommandInput value="" readOnly />
          <CommandList>
            <CommandMode
              state={{ pages: ["root"], query: "" }}
              vault="reef-acme"
              target={null}
              registry={registryWith([])}
              onPushPage={vi.fn()}
              onExecute={vi.fn()}
            />
          </CommandList>
        </Command>
      </IntlTestProvider>,
    );
    expect(screen.queryByText("Change status")).not.toBeInTheDocument();
  });

  it("executes pointer selection through the action focus policy", () => {
    const run = vi.fn();
    const onExecute = vi.fn();
    const action: BoundAppAction = {
      descriptor: {
        id: "view.list",
        labelKey: "viewList",
        aliasKeys: ["list"],
        group: "views",
        scopes: ["global"],
        surfaces: ["palette"],
        parentPage: "view",
        focusPolicy: "navigate",
      },
      label: "List",
      keywords: ["table"],
      current: false,
      run,
    };
    renderMode({
      actions: [action],
      pages: ["root", "view"],
      onExecute,
    });

    fireEvent.click(screen.getByTestId("command-action"));
    expect(onExecute).toHaveBeenCalledWith("navigate", run);
  });

  it("keeps parent pages searchable through locale-independent aliases", () => {
    renderMode({ query: "theme" });

    expect(
      screen.getByText("Change theme").closest("[cmdk-item]"),
    ).toHaveAttribute("data-command-page", "theme");
  });

  it("renders the New issue label visibly and in the option name", () => {
    const action: BoundAppAction = {
      descriptor: {
        id: "issue.new",
        labelKey: "newIssue",
        aliasKeys: ["createIssue", "addIssue"],
        group: "issues",
        scopes: ["global"],
        surfaces: ["palette"],
        focusPolicy: "handoff",
        shortcut: {
          keys: ["mod", "I"],
          scope: "global",
          bindings: [],
        },
      },
      label: "New issue",
      keywords: ["create issue"],
      current: false,
      run: vi.fn(),
    };

    renderMode({ actions: [action] });

    expect(screen.getByText("New issue")).toBeVisible();
    expect(
      screen.getByRole("option", { name: /New issue/i }),
    ).toBeInTheDocument();
  });
});
