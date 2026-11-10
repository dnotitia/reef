import { loadMessages } from "@/i18n/messages";
import script from "@/features/reefPlugin/components/issuePicker.browser?bundle";

export function issueHtml() {
  const en = loadMessages("en");
  const ko = loadMessages("ko");
  const copy = en.reefPlugin.picker;
  const messages = JSON.stringify({
    en: { picker: copy, status: en.fields.status },
    ko: { picker: ko.reefPlugin.picker, status: ko.fields.status },
  }).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title}</title>
<style>
:root {
  color-scheme: light dark;
  --surface: var(--color-background-primary, light-dark(#fff, #191c20));
  --muted-surface: var(--color-background-secondary, light-dark(#f4f6f8, #242930));
  --ink: var(--color-text-primary, light-dark(#1d2631, #eef1f6));
  --muted: var(--color-text-secondary, light-dark(#526072, #b9c4d1));
  --line: var(--color-border-secondary, light-dark(#dce2e9, #414956));
  --control-line: var(--color-border-primary, light-dark(#aab5c4, #667181));
  --selected-surface: var(--color-background-info, light-dark(#eef5ff, #243752));
  --focus: var(--color-ring-info, light-dark(#235ab2, #9fc5ff));
  --action: var(--color-background-inverse, light-dark(#243750, #e6edf8));
  --on-action: var(--color-text-inverse, light-dark(#fff, #182539));
  --radius: var(--border-radius-md, .625rem);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--surface);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--font-text-sm-size, .875rem);
  line-height: 1.45;
}
[hidden] { display: none !important; }
main { max-inline-size: 44rem; margin-inline: auto; }
.panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  block-size: 100dvh;
  padding: var(--safe-top, 0px) var(--safe-right, 0px) var(--safe-bottom, 0px) var(--safe-left, 0px);
}
.panel-scroll { overflow: auto; overscroll-behavior: contain; padding: .875rem .875rem .5rem; }
header { margin-block-end: .875rem; }
h1, h2 { margin: 0; font-size: var(--font-heading-sm-size, 1.125rem); line-height: 1.25; }
.purpose { margin: .3rem 0 0; color: var(--muted); }
.controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: .45rem;
}
.field { display: grid; gap: .2rem; min-inline-size: 0; color: var(--muted); font-size: .75rem; }
.workspace-field { grid-column: 1 / -1; }
select, button {
  font: inherit;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--control-line);
  border-radius: var(--radius);
  max-inline-size: 100%;
}
select { min-block-size: 2.5rem; width: 100%; padding-inline: .375rem; font-size: var(--font-text-sm-size, .875rem); text-overflow: ellipsis; }
button {
  min-block-size: 2.75rem;
  padding: .45rem .75rem;
  font-weight: var(--font-weight-medium, 500);
  overflow-wrap: anywhere;
}
button:enabled, summary, .issue-select { cursor: pointer; }
button:enabled:hover, select:enabled:hover, summary:hover { background: var(--muted-surface); }
button:disabled, select:disabled { opacity: .55; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.primary, .primary:enabled:hover { background: var(--action); border-color: var(--action); color: var(--on-action); }
.primary:enabled:hover { text-decoration: underline; text-underline-offset: .2em; }
.feedback { margin: .75rem 0 .4rem; color: var(--muted); font-size: .8125rem; }
[data-tone="error"] { color: var(--color-text-danger, light-dark(#9a2429, #ffb7b7)); }
[data-tone="accepted"] { color: var(--color-text-success, light-dark(#21603a, #9dd8ae)); }
.issue-list { list-style: none; padding: 0; margin: 0; }
.issue-row, .review-row { border-block-start: 1px solid var(--line); overflow-wrap: anywhere; }
.issue-row:has(input:checked) { background: var(--selected-surface); }
.issue-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
.issue-select {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: .625rem;
  min-block-size: 2.75rem;
  padding: .5rem .25rem;
}
.issue-select:hover { background: var(--muted-surface); }
.issue-select:has(:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; border-radius: var(--radius); }
.issue-select input { inline-size: 1rem; block-size: 1rem; margin: 0; accent-color: var(--action); }
.issue-title { display: block; font-weight: var(--font-weight-semibold, 600); line-height: 1.35; }
.issue-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .45rem; margin-block-start: .25rem; color: var(--muted); font-size: .75rem; }
.issue-status { padding: .075rem .4rem; border-radius: var(--border-radius-full, 1rem); background: var(--muted-surface); }
.details-toggle { inline-size: 2.75rem; padding: 0; border-color: transparent; background: transparent; color: var(--muted); }
.details-toggle::before {
  content: "";
  display: inline-block;
  inline-size: .45rem;
  block-size: .45rem;
  border: solid currentColor;
  border-width: 0 1.5px 1.5px 0;
  transform: translateY(-.15rem) rotate(45deg);
}
.details-toggle[aria-expanded="true"]::before { transform: rotate(225deg); }
.issue-details { display: grid; gap: .3rem; margin: .45rem 0 0; font-size: .75rem; }
.issue-row > .issue-details { margin: 0; padding: 0 .5rem .65rem 1.875rem; }
.issue-details div { display: flex; flex-wrap: wrap; gap: .05rem .5rem; }
.issue-details dt { color: var(--muted); }
.issue-details dd { min-inline-size: 0; margin: 0; overflow-wrap: anywhere; }
.review-row { padding: .625rem .25rem; }
.exact-content { margin-block: .5rem; border: 1px solid var(--line); border-radius: var(--radius); }
.exact-content summary { padding: .7rem; color: var(--muted); border-radius: var(--radius); }
code, pre { font-family: var(--font-mono, ui-monospace, monospace); }
pre {
  margin: 0;
  padding: .75rem;
  border-block-start: 1px solid var(--line);
  background: var(--muted-surface);
  font-size: .75rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.list-actions, .review-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.list-actions:has(button:not([hidden])) { margin-block: .35rem; }
footer {
  display: grid;
  padding: .55rem .875rem;
  border-block-start: 1px solid var(--line);
  background: var(--surface);
}
.selection-bar {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: .45rem;
}
#selected-count { font-size: .8125rem; color: var(--muted); overflow-wrap: anywhere; }
.review-actions { justify-content: space-between; }
.review-actions .primary { margin-inline-start: auto; }
.delivery-status { margin: 0; font-size: .8125rem; }
.delivery-status:not([data-tone]) { color: var(--muted); }
.delivery-status:not(:empty) { margin-block-end: .45rem; }
@media (min-width: 480px) {
  .panel-scroll { padding-inline: 1rem; }
  footer { padding-inline: 1rem; }
  .controls { grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 1fr) auto; }
  .workspace-field { grid-column: auto; }
}
</style></head>
<body><main>
<section id="browse" class="panel" aria-labelledby="browse-heading">
<div class="panel-scroll">
<header>
<h1 id="browse-heading" data-copy="title">${copy.title}</h1>
<p class="purpose" data-copy="browsePurpose">${copy.browsePurpose}</p>
</header>
<div class="controls">
<label class="field workspace-field" for="workspace"><span data-copy="workspace">${copy.workspace}</span><select id="workspace" disabled></select></label>
<label class="field" for="period"><span data-copy="period">${copy.period}</span><select id="period" disabled>
<option value="7" data-copy="days7">${copy.days7}</option><option value="30" data-copy="days30">${copy.days30}</option>
</select></label>
<label class="field" for="status-filter"><span data-copy="status">${copy.status}</span><select id="status-filter" disabled>
<option value="" data-copy="allStatuses">${copy.allStatuses}</option>
</select></label>
<button id="refresh" type="button" data-copy="refresh" disabled>${copy.refresh}</button>
</div>
<p id="feedback" class="feedback" role="status" tabindex="-1">${copy.connecting}</p>
<ul id="issues" class="issue-list"></ul>
<div class="list-actions"><button id="more" type="button" data-copy="more" hidden>${copy.more}</button>
<button id="retry" type="button" data-copy="retry" hidden>${copy.retry}</button></div>
</div>
<footer class="selection-bar"><span id="selected-count" role="status"></span>
<button id="preview" class="primary" type="button" data-copy="preview" disabled>${copy.preview}</button>
</footer>
</section>
<section id="preview-panel" class="panel" aria-labelledby="preview-heading" hidden>
<div id="review-scroll" class="panel-scroll">
<header>
<h2 id="preview-heading" data-copy="previewHeading" tabindex="-1">${copy.previewHeading}</h2>
<p class="purpose" data-copy="reviewPurpose">${copy.reviewPurpose}</p>
</header>
<ol id="review-issues" class="issue-list"></ol>
<details id="exact-content" class="exact-content">
<summary data-copy="exactContent">${copy.exactContent}</summary>
<pre id="preview-text"></pre>
</details>
</div>
<footer>
<p id="delivery-status" class="delivery-status" role="status"></p>
<div class="review-actions">
<button id="back" type="button" data-copy="back">${copy.back}</button>
<button id="send" class="primary" type="button" data-copy="send" disabled>${copy.send}</button>
</div>
</footer>
</section>
</main><script id="reef-picker-messages" type="application/json">${messages}</script>
<script type="module">${script.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
}
