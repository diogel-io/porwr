## Summary

<!-- What changes and why. -->

Fixes diogel-io/workspace#<n>

## Verification

<!-- The verification gate from AGENTS.md, and the e2e suites if the panel, approval flow, or anything a page can reach changed. -->

- [ ] `npm run lint`, `npm run typecheck`, `npm run test:coverage`
- [ ] `npm run build`, `npm run build:chrome`, `npm run build:firefox`
- [ ] `npm run test:e2e` and `npm run test:e2e:firefox`, when required

## Security review

See [SECURITY.md: Security review guidelines](https://github.com/diogel-io/porwr/blob/master/SECURITY.md#security-review-guidelines).

- [ ] This change touches no sensitive path listed in `SECURITY.md`.
- [ ] This change touches a sensitive path, and I have worked through the checklist in
      `SECURITY.md`. Items that do not apply are noted below.
- [ ] `docs/threat-model.md` is updated, or this change adds or changes no asset, boundary, or
      control.

<!-- Notes on checklist items that do not apply, and links to any recorded decision. -->

<!-- Never describe an unfixed vulnerability here. Report it privately as SECURITY.md explains. -->
