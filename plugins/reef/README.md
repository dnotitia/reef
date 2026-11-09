# Connect Reef to Codex

Use the Reef plugin with a self-hosted Reef deployment that already uses
browser SSO. On the Codex Desktop host, make Node.js 22 or later and a current
Codex CLI available on `PATH`. The CLI must support `config/value/write` in
the Codex app server and `codex mcp login --oauth-client-registration dcr`.
The plugin uses the CLI's active user configuration and credential store.

1. Install the Reef plugin from your Codex plugin marketplace and start setup.
2. Give the setup conversation your Reef deployment's HTTPS URL.
3. Finish sign-in in the browser and choose **Allow read access**.
4. Open a new Codex conversation and ask **Open the Reef Issue Picker**.
5. Choose a workspace and filter recent snapshots by period or status. Choose
   **Load more** to append results and keep your selection. **Refresh** and
   filter changes query current data and clear the selection.
6. Select issues and choose **Preview Issue Context**. Review the message, then
   choose **Send to this conversation**. Check the conversation for the message.

If setup is canceled or the Reef connection expires, run the plugin's setup
again with the same URL. Reef grants read access for up to one hour and checks
the linked Reef session on every MCP request. Reef logout also ends access.
If the deployment uses local sign-in, contact your Reef administrator about SSO.

For an isolated development fixture, setup also accepts loopback HTTP. Reef
uses its existing configured public origin for MCP and OAuth discovery and its
existing web SSO callback for sign-in.

## Install from a local checkout

Add the checkout root as a local Codex marketplace. Install **Reef** from the
**Reef** marketplace in the plugin directory, then start setup.
