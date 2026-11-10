import {
  App,
  type McpUiHostContext,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
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

const app = new App(
  { name: "Reef Issue Picker", version: "1.0.0" },
  {},
  { autoResize: false },
);
const PREFERRED_PANEL_HEIGHT = 560;

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
const reviewScroll = element("review-scroll", HTMLElement);
const reviewRows = element("review-issues", HTMLOListElement);
const exactContent = element("exact-content", HTMLDetailsElement);
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

type Delivery =
  | { kind: "ready"; notice?: "sendRejected" | "sendUnconfirmed" }
  | { kind: "sending" }
  | { kind: "accepted" };

type Review = {
  kind: "review";
  snapshot: { rows: QueriedIssue[]; exactText: string };
  delivery: Delivery;
};

let active: QueryRun | undefined;
const selected = new Map<string, QueriedIssue>();
let stage: { kind: "browse" } | Review = { kind: "browse" };
let locale = en;
let dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
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

function showBrowse() {
  if (stage.kind === "review") {
    reviewRows.replaceChildren();
    previewText.textContent = "";
  }
  stage = { kind: "browse" };
  browsing.hidden = false;
  previewPanel.hidden = true;
}

function issueHeading(issue: QueriedIssue) {
  const heading = document.createElement("span");
  const title = document.createElement("span");
  title.className = "issue-title";
  title.textContent = issue.title;
  const meta = document.createElement("span");
  meta.className = "issue-meta";
  const id = document.createElement("span");
  id.textContent = issue.id;
  const badge = document.createElement("span");
  badge.className = "issue-status";
  badge.textContent = statusLabel(issue.status);
  meta.append(id, badge);
  heading.append(title, meta);
  return heading;
}

function issueDetails(issue: QueriedIssue) {
  const detail = document.createElement("dl");
  detail.className = "issue-details";
  function addTerm(label: string, value: HTMLElement) {
    const field = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.append(value);
    field.append(term, description);
    detail.append(field);
  }
  for (const [label, value] of [
    [locale.picker.updated, issue.updated_at],
    [locale.picker.queried, issue.queried_at],
  ]) {
    const time = document.createElement("time");
    time.dateTime = value;
    time.textContent = formatTime(value);
    addTerm(label, time);
  }
  const reference = document.createElement("code");
  reference.textContent = issue.document_uri;
  addTerm(locale.picker.reference, reference);
  return detail;
}

function issueRow(issue: QueriedIssue, index: number) {
  const row = document.createElement("li");
  row.className = "issue-row";
  const line = document.createElement("div");
  line.className = "issue-line";
  const label = document.createElement("label");
  label.className = "issue-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", `${issue.id} ${issue.title}`);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selected.set(issue.document_uri, issue);
    else selected.delete(issue.document_uri);
    syncSelection();
  });
  label.append(checkbox, issueHeading(issue));
  const detail = issueDetails(issue);
  detail.id = `issue-details-${index}`;
  detail.hidden = true;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "details-toggle";
  toggle.setAttribute(
    "aria-label",
    locale.picker.details.replace("{id}", issue.id),
  );
  toggle.setAttribute("aria-controls", detail.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    toggle.setAttribute("aria-expanded", String(!detail.hidden));
  });
  line.append(label, toggle);
  row.append(line, detail);
  return row;
}

function showFeedback(message: string, tone?: "error") {
  feedback.textContent = message;
  if (tone) feedback.dataset.tone = tone;
  else delete feedback.dataset.tone;
}

async function loadPage(run: QueryRun, cursor?: string) {
  const startedWithPageAction =
    document.activeElement === more || document.activeElement === retry;
  const canMoveFocus = () => {
    const focused = document.activeElement;
    return (
      startedWithPageAction &&
      stage.kind === "browse" &&
      (focused === document.body || focused === more || focused === retry)
    );
  };
  showFeedback(
    cursor ? locale.picker.loadingMore : locale.picker.loadingIssues,
  );
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
        appended.push(issueRow({ ...issue, queried_at }, run.seen.size));
      }
      rows.append(...appended);
      run.cursor = next_cursor;
      more.hidden = !next_cursor;
      const queried = `${locale.picker.queried} ${formatTime(queried_at)}`;
      showFeedback(
        run.seen.size ? queried : `${locale.picker.emptyIssues} ${queried}`,
      );
      if (cursor && canMoveFocus()) {
        const target = appended[0]?.querySelector("input") ?? feedback;
        target.focus();
      }
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
  showFeedback(error, "error");
  retry.hidden = false;
  retry.onclick = cursor ? loadMore : newQuery;
  if (canMoveFocus()) retry.focus();
}

function newQuery() {
  selected.clear();
  showBrowse();
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
  showFeedback(locale.picker.loadingWorkspaces);
  retry.hidden = true;
  try {
    const result = await app.callServerTool({
      name: WORKSPACES_TOOL,
      arguments: {},
    });
    const parsed = WorkspacesResult.safeParse(result.structuredContent);
    if (!parsed.success || result.isError) {
      showFeedback(errorLabel(result.structuredContent), "error");
    } else if (!parsed.data.workspaces.length) {
      showFeedback(locale.picker.emptyWorkspaces);
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
    showFeedback(locale.picker.unavailable, "error");
  }
  retry.hidden = false;
  retry.onclick = loadWorkspaces;
}

function openPreview() {
  if (stage.kind !== "browse" || !selected.size) return;
  const rows = Array.from(selected.values());
  stage = {
    kind: "review",
    snapshot: { rows, exactText: issueContextText(rows) },
    delivery: { kind: "ready" },
  };
  reviewRows.replaceChildren(
    ...stage.snapshot.rows.map((issue) => {
      const row = document.createElement("li");
      row.className = "review-row";
      row.append(issueHeading(issue), issueDetails(issue));
      return row;
    }),
  );
  previewText.textContent = stage.snapshot.exactText;
  exactContent.open = false;
  renderDelivery(stage.delivery);
  browsing.hidden = true;
  previewPanel.hidden = false;
  reviewScroll.scrollTop = 0;
  previewHeading.focus();
}

function renderDelivery(delivery: Delivery) {
  back.disabled = delivery.kind === "sending";
  send.disabled = delivery.kind !== "ready";
  delete deliveryStatus.dataset.tone;
  switch (delivery.kind) {
    case "ready":
      deliveryStatus.textContent = delivery.notice
        ? locale.picker[delivery.notice]
        : "";
      if (delivery.notice) deliveryStatus.dataset.tone = "error";
      break;
    case "sending":
      deliveryStatus.textContent = locale.picker.sending;
      break;
    case "accepted":
      deliveryStatus.textContent = locale.picker.sendAccepted;
      deliveryStatus.dataset.tone = "accepted";
      break;
  }
}

async function sendDraft() {
  if (stage.kind !== "review" || stage.delivery.kind !== "ready") return;
  const review = stage;
  review.delivery = { kind: "sending" };
  renderDelivery(review.delivery);
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: review.snapshot.exactText }],
    });
    review.delivery = result.isError
      ? { kind: "ready", notice: "sendRejected" }
      : { kind: "accepted" };
  } catch {
    review.delivery = { kind: "ready", notice: "sendUnconfirmed" };
  }
  if (stage !== review) return;
  renderDelivery(review.delivery);
  (review.delivery.kind === "accepted" ? back : send).focus();
}

for (const control of [workspace, period, statusFilter])
  control.addEventListener("change", newQuery);
refresh.addEventListener("click", newQuery);
more.addEventListener("click", loadMore);
preview.addEventListener("click", openPreview);
back.addEventListener("click", () => {
  showBrowse();
  preview.focus();
});
send.addEventListener("click", sendDraft);

function applyAppearance(context?: McpUiHostContext) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.safeAreaInsets) {
    for (const [edge, size] of Object.entries(context.safeAreaInsets)) {
      document.documentElement.style.setProperty(`--safe-${edge}`, `${size}px`);
    }
  }
}

app.onhostcontextchanged = applyAppearance;

async function connect() {
  try {
    await app.connect();
    const context = app.getHostContext();
    applyAppearance(context);
    const dimensions = context?.containerDimensions;
    if (!dimensions || !("height" in dimensions)) {
      const height = Math.min(
        dimensions?.maxHeight ?? PREFERRED_PANEL_HEIGHT,
        PREFERRED_PANEL_HEIGHT,
      );
      void app.sendSizeChanged({ height }).catch(() => undefined);
    }
    const language = context?.locale ?? "en";
    const korean = language.toLowerCase().startsWith("ko");
    locale = korean ? ko : en;
    const languageTag = korean ? "ko" : "en";
    document.documentElement.lang = languageTag;
    document.title = locale.picker.title;
    const dateOptions = { dateStyle: "medium", timeStyle: "short" } as const;
    try {
      dateFormatter = new Intl.DateTimeFormat(language, {
        ...dateOptions,
        timeZone: context?.timeZone,
      });
    } catch {
      dateFormatter = new Intl.DateTimeFormat(languageTag, dateOptions);
    }
    for (const item of document.querySelectorAll<HTMLElement>("[data-copy]")) {
      item.textContent = locale.picker[item.dataset.copy ?? ""];
    }
    for (const [key, label] of Object.entries(locale.status)) {
      statusFilter.add(new Option(label, key));
    }
    syncSelection();
    await loadWorkspaces();
  } catch {
    showFeedback(locale.picker.connectionFailed, "error");
    retry.hidden = false;
    retry.onclick = connect;
  }
}

void connect();
