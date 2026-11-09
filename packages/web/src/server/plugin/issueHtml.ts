import en from "@/i18n/messages/en.json";
import script from "@/features/reefPlugin/components/issuePicker.browser?bundle";

export function issueHtml() {
  const { title, workspace, refresh, connecting } = en.reefPlugin.picker;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
body{margin:0;padding:16px;font:14px/1.45 system-ui;color:var(--color-text-primary,#182720);background:var(--color-background-primary,#fff)}
main{max-width:48rem;margin:auto}h1{font-size:1.2rem;margin:0 0 .75rem}
.controls{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
select,button{font:inherit;padding:.35rem .6rem;color:inherit;background:inherit;border:1px solid #75857d;border-radius:.4rem;max-width:100%}
:focus-visible{outline:2px solid #168462;outline-offset:2px}button:enabled{cursor:pointer}
ul{list-style:none;padding:0;margin:0}li{padding:.75rem 0;border-top:1px solid #75857d55;overflow-wrap:anywhere}
li p{margin:.2rem 0}code{font-size:.82em}
</style></head>
<body><main><h1>${title}</h1>
<div class="controls"><label for="workspace">${workspace}</label><select id="workspace" disabled></select><button type="button" disabled>${refresh}</button></div>
<p role="status">${connecting}</p><ul></ul>
</main><script type="module">${script.replace(/<\/script/giu, "<\\/script")}</script></body></html>`;
}
