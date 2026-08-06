## Summary

<!-- What does this change, and why? -->

## Related issue

<!-- Reference the internal tracker; do not use GitHub closing keywords for REEF ids. -->
Related issue: REEF-

## How was this tested?

<!-- Scenarios covered, plus the gates below. -->

## Checklist

- [ ] `pnpm run check` passes (package build, isolated artifact smoke, architecture, lint, typecheck, tests, and release policy)
- [ ] `pnpm --filter @reef/web run test:e2e:sharded` passes when the change affects the web surface or shared contracts
- [ ] `CHANGELOG.md` updated under `Unreleased` (for release-impacting changes)
- [ ] Docs updated if behavior or contracts changed
- [ ] No secrets, internal hostnames, or PII added (placeholders only)
