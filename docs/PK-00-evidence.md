# PK-00 local acceptance evidence

Verified on 2026-10-08, macOS 26.6.2 arm64. Base commit: `8b3229f2d440b838099195eb03433eb884ead7db`. Node 22.14.0, npm 10.9.2, Git 2.50.1, gh 2.102.0. Branch: `work/pk-00-foundation`.

| Command                                                             | Exit | Evidence                                                                     |
| ------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| npm install --ignore-scripts                                        | 0    | Initial exact dependency install; unsupported ESLint 9 subsequently replaced |
| npm install --save-dev --save-exact eslint@10.12.0 --ignore-scripts | 0    | Compatible supported ESLint installed                                        |
| npm run format                                                      | 0    | Foundation formatting; original README bytes restored and excluded           |
| npm ci                                                              | 0    | Lockfile install; exact Node/npm preinstall check PASS                       |
| npm run verify                                                      | 0    | format:check, lint, typecheck and test (includes build) all PASS             |
| npm run canonical:verify                                            | 0    | Manifest plus 57/57 canonical document hashes PASS                           |
| npm audit --audit-level=high                                        | 0    | 0 vulnerabilities across installed dependencies                              |

Foundation tests: 4 PASS, 0 FAIL. Checks cover compiled empty workspace exports, canonical integrity, invalid TypeScript rejection and Git secret/output exclusions. No runtime dependency, service, schema, secret adapter or business code exists. Audit covers known package advisories, not proof of complete application security.

CI results belong to the exact pushed commit and are reported in the Draft PR and Owner handoff; local results alone do not imply CI PASS. Reviewer/Owner acceptance and merge remain HOLD. SG-05 PostgreSQL, SG-06 key custody, business QA and release gates remain deferred as documented in PK-00-foundation.md. No migration IDs or business acceptance cases apply to this foundation change.
