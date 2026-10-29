<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Authority rules

- `cto` ADRs in `docs/decisions/` are binding on `dev-lead` and `dev`. Disagreement
  escalates to `ceo`, who may request a new ADR but never silently overrides one.
- `cpo` owns priority; `product-owner` owns story content. Neither may alter the
  other's artifact.
- **CFO gate**: any choice introducing paid services, infrastructure spend, or
  model-tier cost goes to `cfo` before adoption.
- **Security gate**: `dev-lead` routes auth/crypto/dependency/input-handling changes
  to `security-engineer` before approving that story; critical/high findings block
  release. Independent of what was flagged during development, `security-engineer`
  also performs a mandatory audit before `devops-engineer` cuts any release — a
  release with nothing flagged is not exempt.
- **QA gate**: no story is done until `qa-engineer` passes every acceptance criterion.
