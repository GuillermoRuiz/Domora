# API additions

Estate routes start `/api/v1/estates/:estateId/ai`. UUID pipes, JWT/role/subscription guards, current DB user and estate access enforce A/B only; B must manage estate. No tokens/model-generated URLs exposed.

| Method / suffix | Contract |
|---|---|
| GET policies | Policies and active scoped suppliers; defaultAutonomy=1, spendingEnabled=false. |
| PUT policies | `{category,autonomy,supplierId,ccAdministrator,duplicateThreshold,futureSpendingLimitCents}`; real issue/provider category or `*`. |
| GET issues/:issueId | Scoped state/classification, last 50 messages/audits. Existing issue status authoritative. |
| POST messages/:messageId/approval | Approve draft/safe failure; cannot blindly resend unknown SMTP delivery. |
| POST issues/:issueId/appointments/:messageId/confirmation | Complete appointment + actor; no spending/external acceptance. |
| POST invoices/documents | Multipart file <=5 MB, PDF/JPEG/PNG/WebP magic check, hash idempotency, private original/job. |
| GET invoices/documents?page=1 | Page size 30, fields/source/warnings, unknown values null. |
| GET invoices/documents/:id/original | Authenticated private/no-store original download. |
| POST invoices/documents/:id/invoice-link | `{invoiceId}`, existing same-estate invoice; retain existing attachment. No posting. |
| GET reconciliation?page=1 | Actual movement/auto/manual/suggested/unmatched counts; actual entries/lines/invoices, 30/page. Suggested counts distinct still-pending movement IDs, not proposal count. |
| POST banks/:bankId/reconciliation-runs | Authorize scoped bank and queue immediate matching; hourly schedule also runs. |
| POST reconciliation/:id/acceptance | Serializable exact-current-cents recheck, atomic existing links; replay returns group. Unposted invoice candidate rejects. |
| POST reconciliation/:id/rejection | Reject under current manager. |
| GET intelligence | Last completed plus newer processing/failure, server signal navigation links. |
| GET jobs | Latest 50 statuses/attempts/safe errors. |
| POST jobs/:id/retry | Failed non-send work only; SMTP ambiguity needs operator resolution. |

Signed public POST `/api/v1/ai/inbound-email` follows EMAIL_ADAPTER.md; public means JWT bypass, never HMAC bypass.

400 invalid IDs/entities/incomplete proposal; 401 invalid JWT; 403 access; 404 absent original/proposal; 409 changed/already reconciled state. Upload errors use existing Nest/Multer semantics. Worker failures are durable. No spend/unrestricted AI endpoint.
