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
*{box-sizing:border-box}
body{margin:0;padding:16px;font:14px/1.5 system-ui;color:var(--color-text-primary,#182720);background:var(--color-background-primary,#fff)}
main{max-width:48rem;margin:auto}
h1,h2{font-size:1.2rem;margin:0 0 .75rem}
[hidden]{display:none!important}
.controls,.actions{display:flex;gap:.5rem;align-items:end;flex-wrap:wrap}
.controls label{display:grid;gap:.2rem;max-width:100%}
select,button{font:inherit;padding:.4rem .6rem;color:inherit;background:inherit;border:1px solid #75857d;border-radius:.4rem;max-width:100%}
button:enabled,summary,input[type=checkbox]{cursor:pointer}
:focus-visible{outline:2px solid #168462;outline-offset:2px}
select:disabled,button:disabled{opacity:.55;cursor:not-allowed}
ul{list-style:none;padding:0;margin:0}
li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.65rem;align-items:start;padding:.75rem 0;border-top:1px solid #75857d55;overflow-wrap:anywhere}
li input{margin:.36rem 0 0}
summary{overflow-wrap:anywhere}
.issue-status{display:inline-block;font-size:.82em;font-weight:500;margin-inline-start:.45rem;padding:0 .3rem;border:1px solid #75857d80;border-radius:.3rem}
li p{margin:.25rem 0}
code{font-size:.85em;overflow-wrap:anywhere}
footer{display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap;border-top:1px solid #75857d55;margin-top:1rem;padding-top:.65rem}
pre{padding:.75rem;border:1px solid #75857d80;border-radius:.4rem;font-size:.85em;white-space:pre-wrap;overflow-wrap:anywhere}
.primary{background:var(--color-text-primary,#184632);color:var(--color-background-primary,#fff)}
@media(max-width:360px){body{padding:12px}.actions{width:100%}.actions button{flex:1}}
</style></head>
<body><main>
<section id="browse">
<h1 data-copy="title">${copy.title}</h1>
<div class="controls">
<label for="workspace"><span data-copy="workspace">${copy.workspace}</span><select id="workspace" disabled></select></label>
<label for="period"><span data-copy="period">${copy.period}</span><select id="period" disabled>
<option value="7" data-copy="days7">${copy.days7}</option><option value="30" data-copy="days30">${copy.days30}</option>
</select></label>
<label for="status-filter"><span data-copy="status">${copy.status}</span><select id="status-filter" disabled>
<option value="" data-copy="allStatuses">${copy.allStatuses}</option>
</select></label>
<button id="refresh" type="button" data-copy="refresh" disabled>${copy.refresh}</button>
</div>
<p id="feedback" role="status">${copy.connecting}</p>
<ul id="issues"></ul>
<div class="actions"><button id="more" type="button" data-copy="more" hidden>${copy.more}</button>
<button id="retry" type="button" data-copy="retry" hidden>${copy.retry}</button></div>
<footer><span id="selected-count"></span>
<button id="preview" type="button" data-copy="preview" disabled>${copy.preview}</button>
</footer>
</section>
<section id="preview-panel" aria-labelledby="preview-heading" hidden>
<h2 id="preview-heading" data-copy="previewHeading" tabindex="-1">${copy.previewHeading}</h2>
<pre id="preview-text"></pre>
<p id="delivery-status" role="status"></p>
<div class="actions">
<button id="back" type="button" data-copy="back">${copy.back}</button>
<button id="send" class="primary" type="button" data-copy="send" disabled>${copy.send}</button>
</div>
</section>
</main><script id="reef-picker-messages" type="application/json">${messages}</script>
<script type="module">${script.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
}
