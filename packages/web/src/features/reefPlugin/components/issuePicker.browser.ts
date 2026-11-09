import { App } from "@modelcontextprotocol/ext-apps";
import {
  ISSUES_TOOL,
  IssuesResult,
  ReadError,
  WORKSPACES_TOOL,
  WorkspacesResult,
} from "../../../lib/reefPlugin/issueContract";
import en from "../../../i18n/messages/en.json";
import ko from "../../../i18n/messages/ko.json";

const heading = document.querySelector("h1");
const chooser = document.querySelector("label");
const workspace = document.querySelector("select");
const refresh = document.querySelector("button");
const status = document.querySelector("[role=status]");
const rows = document.querySelector("ul");
if (!heading || !chooser || !workspace || !refresh || !status || !rows) {
  throw new Error("Reef App template is incomplete");
}

const app = new App({ name: "Reef Issue Picker", version: "1.0.0" }, {});
let requestNumber = 0;
let copy = en.reefPlugin.picker;
let language = "en";

function report(result: unknown) {
  const parsed = ReadError.safeParse(result);
  return copy[parsed.success ? parsed.data.error : "unavailable"];
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language);
}

function renderIssue(issue: typeof IssuesResult.shape.issues.element._output) {
  const row = document.createElement("li");
  const title = document.createElement("strong");
  title.textContent = `${issue.id} · ${issue.title}`;
  const details = document.createElement("p");
  details.textContent = `${issue.status} · ${copy.updated} ${formatTime(issue.updated_at)}`;
  const reference = document.createElement("code");
  reference.textContent = issue.document_uri;
  row.append(title, details, reference);
  return row;
}

async function loadIssues() {
  if (!status || !workspace || !rows) return;
  const requestId = ++requestNumber;
  status.textContent = copy.loadingIssues;
  rows.replaceChildren();
  try {
    const result = await app.callServerTool({
      name: ISSUES_TOOL,
      arguments: { workspace: workspace.value },
    });
    if (requestId !== requestNumber) return;
    const parsed = IssuesResult.safeParse(result.structuredContent);
    if (!parsed.success) {
      status.textContent = report(result.structuredContent);
      return;
    }
    const { issues, queried_at } = parsed.data;
    rows.replaceChildren(...issues.map(renderIssue));
    const queried = `${copy.queried} ${formatTime(queried_at)}`;
    status.textContent = issues.length
      ? queried
      : `${copy.emptyIssues} ${queried}`;
  } catch {
    if (requestId === requestNumber) status.textContent = copy.unavailable;
  }
}

async function loadWorkspaces() {
  if (!status || !workspace || !refresh) return;
  status.textContent = copy.loadingWorkspaces;
  refresh.disabled = true;
  try {
    const result = await app.callServerTool({
      name: WORKSPACES_TOOL,
      arguments: {},
    });
    const parsed = WorkspacesResult.safeParse(result.structuredContent);
    if (!parsed.success) {
      status.textContent = report(result.structuredContent);
      return;
    }
    const names = parsed.data.workspaces;
    if (!names.length) {
      status.textContent = copy.emptyWorkspaces;
      return;
    }
    workspace.replaceChildren(...names.map((name) => new Option(name, name)));
    workspace.disabled = false;
    await loadIssues();
  } catch {
    status.textContent = copy.unavailable;
  } finally {
    refresh.disabled = false;
  }
}

workspace.addEventListener("change", loadIssues);
refresh.addEventListener("click", () =>
  workspace.value ? loadIssues() : loadWorkspaces(),
);

async function connect() {
  if (!status || !heading || !chooser || !refresh) return;
  try {
    await app.connect();
    language = app.getHostContext()?.locale ?? "en";
    copy = language.toLowerCase().startsWith("ko")
      ? ko.reefPlugin.picker
      : en.reefPlugin.picker;
    document.documentElement.lang = copy === ko.reefPlugin.picker ? "ko" : "en";
    heading.textContent = copy.title;
    chooser.textContent = copy.workspace;
    refresh.textContent = copy.refresh;
    await loadWorkspaces();
  } catch {
    status.textContent = copy.connectionFailed;
  }
}

void connect();
