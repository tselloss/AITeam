<!-- Generated from docs/team-protocol.md by scripts/split-protocol.mjs. Edit the source, then run: npm run build:protocol -->
# Feature pipeline

human/`ceo` → `cpo` (initiative brief) → `business-analyst` (requirements, complex initiatives only —
`cpo` may route straight to `product-owner` for narrowly-scoped asks) → `product-owner` (stories +
acceptance criteria) → `designer` (specs, UI stories only) → `dev-lead` (task breakdown) → `dev` ×N
(implement) → `qa-engineer` (verify) → `dev-lead` (review verdict) → `devops-engineer` (release)
→ `tech-writer` (user-facing docs + changelog), and → `docs-engineer` when the change was
architecturally significant (new module, changed integration, new public interface).
