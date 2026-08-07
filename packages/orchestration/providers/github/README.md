# @reef/scm-provider-github

Private GitHub SCM adapter for the `@reef/orchestrator` `ScmProvider` contract.

The factory binds one provider-neutral repository id to one GitHub
`owner/name`, one exact local working tree, one expected remote, one base
branch, an explicit allowed-branch policy, and separate commit, push, and pull
request permissions. Each operation revalidates that binding before it reads or
mutates Git state.

The adapter resolves refs after fetching the configured remote, creates only
deterministic branches, commits only a non-empty current branch workspace, and
pushes only non-force fast-forward branch refs. Default-branch, tag, force, and
refspec injection attempts are rejected. Draft pull requests are reused only
when an open PR has the exact head and base; an existing ready PR is returned
unchanged. New pull requests are always created as drafts and the adapter never
merges, submits reviews, or changes labels, milestones, or assignees.

Git transport credentials stay in the caller-owned client/environment boundary.
The package never stores or returns them, authenticated URLs, local paths, raw
Git output, or raw GitHub payloads. Tests use a disposable real Git repository,
a local bare remote, and a mock REST server; no live repository mutation is
required.
