import { App } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import {
  ISSUES_TOOL,
  IssuePeriod,
  type IssueFilters,
  IssuesResult,
  type QueriedIssue,
  ReadError,
  WORKSPACES_TOOL,
  WorkspacesResult,
  issueContextText,
} from "../../../lib/reefPlugin/issueContract";

const StringLabels = z.record(z.string(), z.string());
const LocaleData = z.object({ picker: StringLabels, status: StringLabels });
const { en, ko } = z
  .object({ en: LocaleData, ko: LocaleData })
  .parse(
    JSON.parse(
      document.getElementById("reef-picker-messages")?.textContent ?? "",
    ),
  );

const app = new App({ name: "Reef Issue Picker", version: "1.0.0" }, {});

function element<T extends Element>(id: string, type: { new (): T }) {
  const found = document.getElementById(id);
  if (!(found instanceof type))
    throw new Error(`Missing Reef App element ${id}`);
  return found;
}

const workspace = element("workspace", HTMLSelectElement);
const period = element("period", HTMLSelectElement);
const statusFilter = element("status-filter", HTMLSelectElement);
const refresh = element("refresh", HTMLButtonElement);
const feedback = element("feedback", HTMLElement);
const rows = element("issues", HTMLUListElement);
const more = element("more", HTMLButtonElement);
const retry = element("retry", HTMLButtonElement);
const selectedCount = element("selected-count", HTMLElement);
const preview = element("preview", HTMLButtonElement);
const browsing = element("browse", HTMLElement);
const previewPanel = element("preview-panel", HTMLElement);
const previewHeading = element("preview-heading", HTMLElement);
const previewText = element("preview-text", HTMLPreElement);
const back = element("back", HTMLButtonElement);
const send = element("send", HTMLButtonElement);
const deliveryStatus = element("delivery-status", HTMLElement);

type QueryRun = {
  filters: IssueFilters;
  seen: Set<string>;
  cursor: string | null;
  cutoff?: string;
  loadingMore: boolean;
};

let active: QueryRun | undefined;
const selected = new Map<string, QueriedIssue>();
let draft: string | undefined;
let delivery: "ready" | "sending" | "accepted" = "ready";
let locale = en;
let language = "en";

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language);
}

function statusLabel(value: string) {
  return locale.status[value] ?? value;
}

function errorLabel(result: unknown) {
  const parsed = ReadError.safeParse(result);
  return locale.picker[parsed.success ? parsed.data.error : "unavailable"];
}

function syncSelection() {
  selectedCount.textContent = locale.picker.selectedCount.replace(
    "{count}",
    String(selected.size),
  );
  preview.disabled = !selected.size;
}

function clearDraft() {
  draft = undefined;
  delivery = "ready";
  deliveryStatus.textContent = "";
  browsing.hidden = false;
  previewPanel.hidden = true;
}

function issueRow(issue: QueriedIssue) {
  const row = document.createElement("li");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", `${issue.id} ${issue.title}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.set(issue.document_uri, issue);
    else selected.delete(issue.document_uri);
    syncSelection();
  });
  const detail = document.createElement("details");
  const summary = document.createElement("summary");
  const title = document.createElement("strong");
  title.textContent = `${issue.id} · ${issue.title}`;
  const badge = document.createElement("span");
  badge.className = "issue-status";
  badge.textContent = statusLabel(issue.status);
  summary.append(title, badge);

  const updated = document.createElement("p");
  updated.textContent = `${locale.picker.updated} ${formatTime(issue.updated_at)}`;
  const queried = document.createElement("p");
  queried.textContent = `${locale.picker.queried} ${formatTime(issue.queried_at)}`;
  const reference = document.createElement("code");
  reference.textContent = issue.document_uri;
  detail.append(summary, updated, queried, reference);
  row.append(checkbox, detail);
  return row;
}

async function loadPage(run: QueryRun, cursor?: string) {
  feedback.textContent = cursor
    ? locale.picker.loadingMore
    : locale.picker.loadingIssues;
  retry.hidden = true;
  more.disabled = true;
  let error = locale.picker.unavailable;
  try {
    const result = await app.callServerTool({
      name: ISSUES_TOOL,
      arguments: {
        ...run.filters,
        ...(cursor ? { cursor, as_of: run.cutoff } : {}),
      },
    });
    if (active !== run) return;
    const parsed = IssuesResult.safeParse(result.structuredContent);
    if (!parsed.success || result.isError) {
      error = errorLabel(result.structuredContent);
    } else {
      const { issues, queried_at, as_of, next_cursor } = parsed.data;
      run.cutoff = as_of;
      const appended = [];
      for (const issue of issues) {
        if (run.seen.has(issue.document_uri)) continue;
        run.seen.add(issue.document_uri);
        appended.push(issueRow({ ...issue, queried_at }));
      }
      rows.append(...appended);
      run.cursor = next_cursor;
      more.hidden = !next_cursor;
      const queried = `${locale.picker.queried} ${formatTime(queried_at)}`;
      feedback.textContent = run.seen.size
        ? queried
        : `${locale.picker.emptyIssues} ${queried}`;
      if (cursor) appended[0]?.querySelector("input")?.focus();
      return;
    }
  } catch {
    if (active !== run) return;
  } finally {
    if (active === run) {
      run.loadingMore = false;
      more.disabled = false;
    }
  }
  feedback.textContent = error;
  retry.hidden = false;
  retry.onclick = cursor ? loadMore : newQuery;
}

function newQuery() {
  selected.clear();
  clearDraft();
  syncSelection();
  rows.replaceChildren();
  more.hidden = true;
  const days = IssuePeriod.parse(Number(period.value));
  const run: QueryRun = {
    filters: {
      workspace: workspace.value,
      days,
      ...(statusFilter.value ? { status: statusFilter.value } : {}),
    },
    seen: new Set(),
    cursor: null,
    loadingMore: false,
  };
  active = run;
  void loadPage(run);
}

function loadMore() {
  if (!active?.cursor || active.loadingMore) return;
  active.loadingMore = true;
  void loadPage(active, active.cursor);
}

async function loadWorkspaces() {
  feedback.textContent = locale.picker.loadingWorkspaces;
  retry.hidden = true;
  try {
    const result = await app.callServerTool({
      name: WORKSPACES_TOOL,
      arguments: {},
    });
    const parsed = WorkspacesResult.safeParse(result.structuredContent);
    if (!parsed.success || result.isError) {
      feedback.textContent = errorLabel(result.structuredContent);
    } else if (!parsed.data.workspaces.length) {
      feedback.textContent = locale.picker.emptyWorkspaces;
      return;
    } else {
      workspace.replaceChildren(
        ...parsed.data.workspaces.map((name) => new Option(name, name)),
      );
      for (const control of [workspace, period, statusFilter, refresh])
        control.disabled = false;
      newQuery();
      return;
    }
  } catch {
    feedback.textContent = locale.picker.unavailable;
  }
  retry.hidden = false;
  retry.onclick = loadWorkspaces;
}

function openPreview() {
  if (!selected.size) return;
  draft = issueContextText(selected.values());
  previewText.textContent = draft;
  browsing.hidden = true;
  previewPanel.hidden = false;
  send.disabled = false;
  previewHeading.focus();
}

async function sendDraft() {
  if (!draft || delivery !== "ready") return;
  delivery = "sending";
  send.disabled = true;
  back.disabled = true;
  deliveryStatus.textContent = locale.picker.sending;
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: draft }],
    });
    if (result.isError) {
      deliveryStatus.textContent = locale.picker.sendRejected;
    } else {
      delivery = "accepted";
      deliveryStatus.textContent = locale.picker.sendAccepted;
    }
  } catch {
    deliveryStatus.textContent = locale.picker.sendUnconfirmed;
  } finally {
    back.disabled = false;
    if (delivery !== "accepted") {
      delivery = "ready";
      send.disabled = false;
      send.focus();
    } else {
      back.focus();
    }
  }
}

for (const control of [workspace, period, statusFilter])
  control.addEventListener("change", newQuery);
refresh.addEventListener("click", newQuery);
more.addEventListener("click", loadMore);
preview.addEventListener("click", openPreview);
back.addEventListener("click", () => {
  clearDraft();
  preview.focus();
});
send.addEventListener("click", sendDraft);

async function connect() {
  try {
    await app.connect();
    language = app.getHostContext()?.locale ?? "en";
    const korean = language.toLowerCase().startsWith("ko");
    locale = korean ? ko : en;
    document.documentElement.lang = korean ? "ko" : "en";
    for (const item of document.querySelectorAll<HTMLElement>("[data-copy]")) {
      item.textContent = locale.picker[item.dataset.copy ?? ""];
    }
    for (const [key, label] of Object.entries(locale.status)) {
      statusFilter.add(new Option(label, key));
    }
    syncSelection();
    await loadWorkspaces();
  } catch {
    feedback.textContent = locale.picker.connectionFailed;
    retry.hidden = false;
    retry.onclick = connect;
  }
}

void connect();
