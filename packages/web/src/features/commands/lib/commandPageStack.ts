import type { CommandPage } from "./appActionCatalog";

export interface CommandPageState {
  pages: ReadonlyArray<CommandPage>;
  query: string;
  close?: boolean;
}

export type CommandPageEvent =
  | { type: "push"; page: Exclude<CommandPage, "root"> }
  | { type: "query"; query: string }
  | { type: "backspace" }
  | { type: "escape" }
  | { type: "reset" };

export const initialCommandPageState: CommandPageState = {
  pages: ["root"],
  query: "",
};

export function reduceCommandPageState(
  state: CommandPageState,
  event: CommandPageEvent,
): CommandPageState {
  if (event.type === "reset") return initialCommandPageState;
  if (event.type === "query") {
    return { pages: state.pages, query: event.query };
  }
  if (event.type === "push") {
    return { pages: [...state.pages, event.page], query: "" };
  }

  const nested = state.pages.length > 1;
  const canPop = nested && state.query === "";
  if (event.type === "backspace") {
    return canPop ? { pages: state.pages.slice(0, -1), query: "" } : state;
  }
  if (event.type === "escape" && nested) {
    return { pages: state.pages.slice(0, -1), query: "" };
  }
  return { ...state, close: true };
}
