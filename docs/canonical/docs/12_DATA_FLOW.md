# Data Flow / ER Overview

```mermaid
flowchart TD
  W[Workspace] --> M[Membership]
  U[User] --> M
  U --> C[Credentials / Sessions]
  M --> E[Employee]
  E --> EP[Employee Position]
  EP --> JP[Job Position]
  E --> S[Attendance Shift]
  S --> B[Unpaid Break]
  S --> A[Approval]
  A --> PL[Payroll Calculation Line]
  PR[Effective Pay Rate] --> PL
  PL --> PI[Payroll Item]
  PP[Payroll Period] --> PI
  E --> DR[Daily Report]
  E --> WA[Work Assignment]
  WI[Work Item] --> WA
  WA --> WS[Submission]
  WS --> WR[Review]
  WI --> SF[Assigned Storage Folder]
  SF --> FR[Folder Revision]
  FR --> RC[Download Receipt]
  MA[Managed Account] --> AS[Encrypted Secret]
  MA --> CP[Contact Link]
  AO[Audit / Outbox / Idempotency] -. records .-> W
```

Flow: Staff request → secure session → workspace RBAC → module-owned transaction in PostgreSQL → audit + outbox where needed → asynchronous provider operation (email/Drive) → reconciliation → UI reads actual status. Redis may accelerate reads but never be authoritative. Secret keys outside DB; staff cannot access managed account secrets.
