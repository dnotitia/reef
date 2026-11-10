# Connect Reef to Codex

Use the Reef plugin with a self-hosted Reef deployment that already uses
Keycloak SSO and has enabled [Codex access](../../docs/deployment.md#codex-access-with-keycloak).
On the Codex Desktop host, make Node.js 22 or later and a current
Codex CLI available on `PATH`. The CLI must support `config/value/write` in
the Codex app server and `codex mcp login --oauth-client-registration dcr`.
The plugin uses the CLI's active user configuration and credential store.

1. Install the Reef plugin from your Codex plugin marketplace and start setup.
2. Give the setup conversation your Reef deployment's HTTPS URL.
3. Sign in to Keycloak in the browser and approve Reef issue read access.
4. Open a new Codex conversation and ask **Open the Reef Issue Picker**.
5. Choose a workspace and filter recent snapshots by period or status. Choose
   **Load more** to append results and keep your selection. **Refresh** and
   filter changes query current data and clear the selection.
6. Select issues and choose **Preview Issue Context**. Review the message, then
   choose **Send to this conversation**. Check the conversation for the message.

If setup is canceled or the Reef connection expires, run the plugin's setup
again with the same URL. Codex stores and refreshes its own Keycloak credential.
Codex requests `offline_access` to refresh after the browser session ends.
Reef checks Keycloak and AKB access on each MCP request. To disconnect Codex,
run `codex mcp logout <name>` for the Reef connection. Reef web sign-out ends
the browser session. Ask your Reef administrator about realm-level revocation
if you need to end all access for an account.

For an isolated development fixture, setup also accepts loopback HTTP. Reef
advertises the deployment's Keycloak realm in MCP discovery, and Codex uses a
native loopback callback for sign-in.

## Install from a local checkout

Add the checkout root as a local Codex marketplace. Install **Reef** from the
**Reef** marketplace in the plugin directory, then start setup.
