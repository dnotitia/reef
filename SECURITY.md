# Security Policy

reef sits on the credential path for a team: it brokers deployment-managed
GitHub credentials, the `__reef_session` httpOnly cookie that carries an AKB
session, and optional server-side LLM credentials, and it proxies configured
requests to an LLM. Because of that, we take security reports seriously and ask
that they be disclosed privately.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** A
public issue can expose users before a fix is available.

Instead, use one of these private channels:

- **GitHub private vulnerability reporting** — preferred. On this repository's
  **Security** tab, choose **Report a vulnerability** to open a private
  advisory visible only to maintainers.
- **Email** — `younglo_kim-oss@dnotitia.com`.

Please include enough detail to reproduce: affected version or commit, a
description of the issue, the impact you observed, and any proof-of-concept
steps. If your report involves credentials or tokens, redact them.

We will acknowledge your report, work with you on a fix and a coordinated
disclosure timeline, and credit you if you would like.

## Supported versions

reef is released as a single product version and is currently in the `0.x`
series. Security fixes target the **latest released version line**; please
upgrade to the most recent release before reporting, and report against it.

| Version | Supported |
| --- | --- |
| Latest release line | Yes |
| Older versions | No |

## Scope notes

- Per-user secrets are intentionally kept out of server storage: the AKB
  session is an httpOnly cookie decoded read-only per request, and GitHub access
  is deployment-managed through a server-side GitHub App (with an optional
  `REEF_GITHUB_PAT` fallback for local and CI) rather than a browser-stored
  token. Reports that demonstrate a leak of these credentials (to logs, LLM
  prompts, the URL, or another user) are in scope.
- LLM configuration (`REEF_LLM_API_KEY`, `REEF_LLM_BASE_URL`, and
  `REEF_LLM_MODEL`) is deployment-managed server state and must never be
  exposed to clients or included in prompts. All three values enable the LLM
  capability; no values disable it, and partial configuration fails closed.
