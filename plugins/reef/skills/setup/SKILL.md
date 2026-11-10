---
name: setup
description: Connect a self-hosted Reef deployment to Codex using Keycloak sign-in.
---

Ask for the Reef deployment URL if the user has not supplied it. Do not request
passwords, tokens, callback URLs, OAuth client IDs, or scopes.

Run `node ../../scripts/connect.mjs <url>` from this skill's directory, or resolve
the script relative to this skill. Pass the supplied URL as one literal argument.
The helper needs Node.js 22 or newer and the Codex CLI for this desktop host.
Run the helper yourself. Ask the user to sign in to Keycloak and approve read
access in the browser while the helper is running.

Use the reported stage to explain any failure and ask the user to retry setup
after correcting it. If the deployment has not enabled Codex access, direct the
user to their Reef administrator. A saved connection may still need sign-in.

After OAuth succeeds, ask the user to open a new Codex conversation and say
“Open the Reef Issue Picker.” Setup verifies connection and sign-in. The App
is ready to use when it opens and displays the workspaces or issues in that chat.
