# SEC-02 — Security Architecture Review
Version: 0.1.0-doc.3 | 2026-10-08 | Status: Design PASS, implementation readiness HOLD

## Scope and immutable policy
Owner/staff only auth roles; positions are not roles. Owner-only managed-account secrets. Owner cannot approve own attendance and is payroll-ineligible. No code, migration, or executor work authorized.

## Threat register (all P0 when applicable)
SEC-T01 staff secret access; T02 IDOR/workspace leakage; T03 stolen session; T04 CSRF; T05 XSS and revealed secrets; T06 activation token leakage; T07 key or backup compromise; T08 reauth/reveal replay; T09 suspended user stale access; T10 concurrent authorization race; T11 Drive ACL drift; T12 log/telemetry/backup leakage.

## Authentication and activation
- No public registration; Owner creates employee; one-time bootstrap restricted to installation.
- Password hash Argon2id with per-hash salt, parameters benchmarked for deployment; no recoverable login password.
- Activation tokens CSPRNG at least 256 bits entropy, only keyed hash or hash persisted, single use, 24-hour default expiry; no token in logs or analytics. Consume atomically with credential activation; invalidate prior outstanding invites when reissued.
- Email queued/accepted/delivered are distinct; durable outbox and attempts, unknown provider acceptance reconciled; stale email links fail safely; do not claim delivered on 202 queued.
- Prevent enumeration with generic public errors; Owner admin status can report queued/accepted/delivered only if provider evidence exists. Rate limit login, invite, activation, reauth, reveal.

## Session and CSRF
- Opaque server-side session, cookie Secure HttpOnly SameSite=Lax or stricter, __Host- prefix where deployment permits; no session tokens in localStorage.
- Session identifier rotates on login, privilege change and successful high-risk reauth; logout/suspend/password change revoke sessions according to credential version and current status. Every privileged request checks live membership, employee status and workspace scope; Redis is cache-only, no stale allow on failure.
- Idle timeout default 30 min; absolute timeout default 12 h, configurable deployment security constants, no indefinite remember-me in V0.1. Cookie-based unsafe methods require CSRF token + Origin/Referer allowlist; CORS exact origin, credentials only for allowed origin.
- TLS required for production; CSP nonces/hashes and output encoding, no inline untrusted HTML, restrictive Referrer-Policy, HSTS when HTTPS deployed.

## Managed account secrets
- Login passwords and account secrets use distinct schemes. External secrets encrypted using AES-256-GCM (or approved equivalent AEAD) with fresh unique nonce per encryption and key_version; AAD includes workspace_id, account_id, secret_type, schema_version.
- Master keys outside database and repository, preferably secret manager/KMS; access only dedicated server process, least privilege; no plaintext fallback. Rotation retains old versions until re-encryption and verified recovery. Backups encrypted and restore-tested, access logged.
- Owner-only metadata access; secret reveal requires fresh reauth, scoped to actor/session/account/action, max 5 minutes, single use. Verify permissions again at reveal. Reveal response Cache-Control: no-store; never put secret in list/detail, logs, traces, analytics, errors, exports or browser storage. UI clears reveal on close/navigation; screenshot prevention cannot be guaranteed.
- Reauth response cannot carry secret; reauth challenge and reveal are distinct requests. On failed reauth/rate limit, no reveal. Audit secret access metadata, not secret value.

## Authorization matrix and resource checks
- Every endpoint validates authenticated session, active membership, role, employee status when relevant, resource workspace, assignment and workflow state. Deny by default. 404 for hidden inaccessible resource, 403 for known forbidden operation, 401 unauthenticated, 412 stale If-Match.
- Staff may only manage own attendance and daily reports; no account metadata/secrets. Owner administers managed accounts and payroll, cannot self-approve attendance. Position alone never grants access to all jobs/files. Recheck access after assignment revocation; no stale cache allow.
- Database composite workspace FKs and service-level authorization both required. Cross-workspace FK and IDOR tests are P0.

## External systems and audit
- Email/Drive are external nontransactional systems; durable outbox/operation records with unknown states and reconciliation. Drive permissions must be checked against actual provider ACL. Trash requires Owner two-step confirmation, exact folder revision, current receipts, recheck just before operation, no false success.
- Structured audit for login, activation, suspension, reauth, reveal, secret changes, role changes, attendance approvals, payroll finalize and Drive Trash. Capture actor, workspace, action, resource ID, outcome, timestamp, request_id, but no tokens/secrets/raw request body. Restrict audit access to Owner and operations.
- Avoid secret exposure in URL, query parameters, Referrer, exception telemetry, debug dumps and browser persistence. Retention policy and key recovery runbook required before production.

## API security amendments
POST /api/v1/auth/reauth creates action-bound short-lived authorization, not a secret. POST /api/v1/accounts/{id}/secrets/reveal consumes authorization, returns secret only in no-store response, audits access. All unsafe cookie-authenticated endpoints CSRF-protected. Activation endpoint atomically consumes one-time token. Auth error envelopes never reveal user existence.

## P0 acceptance matrix
S01 staff list/detail/reveal 403; S02 cross-workspace resource concealed; S03 reauth missing/expired/replayed denied; S04 no plaintext secret in DB/log/API list; S05 ciphertext swapped across account fails AEAD; S06 key unavailable fails closed; S07 session invalid after suspension/password change; S08 CSRF rejected; S09 activation token reuse/expiry/reissue denied; S10 concurrent invite/reveal races safe; S11 no provider false-success; S12 Drive ACL/revision Trash blocked; S13 backup restore/rotation drill before production; S14 browser cache and CSP verified; S15 429 throttling verified.

## Open gates and STOP
SEC-02 closes security design defaults but does NOT attest implementation. Before production: select/deploy KMS or external key management, validate TLS/domain/cookie settings, test key rotation and encrypted restore, confirm provider email and Drive ACL integration, implement retention and incident response runbooks, run P0 tests and independent review. If deployment constraints conflict with requirements, STOP + ASK Owner; no unilateral cost commitments.

## Decision log
SEC-021 distinct hash vs AEAD; SEC-022 keys outside DB/repo; SEC-023 nonce/AAD/key version; SEC-024 one-time scoped reauth <=5m; SEC-025 opaque secure server session with revocation; SEC-026 CSRF/CSP/TLS; SEC-027 activation one-use 24h default, token hash; SEC-028 durable email/Drive reconciliation; SEC-029 backend default-deny workspace isolation; SEC-030 audit redaction; SEC-031 production deployment gates; SEC-032 no Owner policy changes or V0.2 scope expansion.
