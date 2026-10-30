# Environment and deployment

`ai.env.example` is documentation, not a secret-bearing .env. Existing API base/auth and ConfigService are reused.

| Variable | Default / purpose |
|---|---|
| AI_ENABLED | false; model calls require explicit true; key/model required at startup. |
| AI_WORKER_ENABLED | false; activate durable jobs/schedules only on intended replicas. |
| AI_AUTO_RECONCILE | false; unique high-evidence bank-to-existing-journal commits require opt-in. Deterministic suggestions do not require OpenAI. |
| OPENAI_API_KEY | Server secret store only. |
| OPENAI_MODEL | No default: choose current Responses/Batch + strict Structured Outputs compatible model. |
| OPENAI_VISION_MODEL | Optional fallback to OPENAI_MODEL; image/PDF compatible when used. Batches group by actual model. |
| AI_WORKER_KINDS | Optional comma list of job kinds this worker claims (e.g. `invoice,accounting,weekly`); blank = all. |
| OPENAI_BASE_URL | Optional. Endpoint of the OpenAI API (https; http only to localhost in development/test). Default `https://api.openai.com/v1` (global). For EU data residency use the EU host of the account's project, e.g. `https://eu.api.openai.com/v1` — verify the exact host, and that Responses + Batch/Files are available there, against OpenAI's documentation and the account. |
| OPENAI_PROJECT_ID / OPENAI_ORGANIZATION_ID | Optional `OpenAI-Project` / `OpenAI-Organization` headers. Project id is mandatory when `AI_REQUIRE_REGION=eu` (the region is a property of the project, not of the host alone). |
| AI_REQUIRE_REGION | `none` (default) or `eu`. With `eu`, the assistant is only usable if `OPENAI_BASE_URL` is an EU host (`AI_EU_HOSTS`, comma list; default `eu.api.openai.com`) AND a project id is set. Otherwise it **fails closed**: no call is made, never a fallback to the global endpoint, and the AI features of Accounting, Meetings and the Assistant are unavailable. The code never claims contractual EU residency: it only checks the endpoint. Any other value is treated as unsatisfiable. |
| AI_BATCH_FILE_RETENTION_HOURS | Default 0 = delete OpenAI Batch files (input/output/error) as soon as results are applied. Hours to keep them before deletion. The retention period is a business decision; 0 is only the safest technical default. |
| AI_REQUEST_RESULT_RETENTION_HOURS | Unset (code default, and the PRODUCTION setting until a period is documented) = `ai_requests.result` is NOT purged: the definitive period is pending a legal/product decision and none is invented. When set (0 = immediately) the model output is emptied once the request is `completed` — i.e. already materialised in its entity (invoice, reconciliation, weekly summary…). Development/test configuration (`ai.env.example`, `local-preview`): 24. `ai_audit` keeps technical metadata only. |
| AI_REQUEST_PAYLOAD_RETENTION_HOURS | Default 0 = empty `ai_requests.payload` (prompt + attachments) as soon as the request completes. Results (`ai_requests.result`) and audit rows are NOT purged: their retention is undecided. |
| AI_WORKER_HEARTBEAT_SECONDS | Default 30. How often each worker process (`AI_WORKER_ENABLED=true`) writes its heartbeat row (`ai_worker_heartbeats`). |
| AI_WORKER_HEARTBEAT_STALE_SECONDS | Default 150 (never below two heartbeat intervals). Without a newer heartbeat there is no live worker for a job kind (`AiWorkerHeartbeatService.coverage`). |
| ISSUE_STALLED_GRACE_MINUTES | Default 240 (4 h; a person may legitimately be mid-work, so short margins only create noise). An open incident with no task, wait or visit and no activity for this long is `stalled` and gets a `review_issue/no_next_step` task. |
| ISSUE_SWEEP_ENABLED | Default true. Cron `domora-issue-sweep` (every 10 min): overdue waits, past visits without outcome + stalled incidents. Independent of `AI_WORKER_ENABLED` and of the AI itself. |
| PDFTOTEXT_PATH | Optional trusted absolute Poppler path; blank skips deterministic PDF text and uses Batch/manual review. |

Reuse DATABASE_URL, STORAGE_DIR, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and existing SMTP secure convention. Confirm actual production wiring against MailService/infra.

REQUIRES DEVELOPER DECISION: always-on minimum replica or dedicated Nest worker. Cron cannot fire at scale-to-zero; ten-minute recovery catches the current Madrid week on resumption, not every missed historical week. Multiple replicas use leases/advisory coordination. Batch coordination can hold one DB connection/transaction up to four minutes; reserve pool capacity for separate feature writes.

REQUIRES DEVELOPER DECISION: install Poppler on worker/in Alpine image (vendor poppler-utils) and verify resource limits. No Docker/infra edits applied. Parsing uses execFile, no shell/AI-supplied path, timeout/output bounds and temp cleanup.

REQUIRES DEVELOPER DECISION: model/project limits/budget, data processing/retention, provider-file cleanup, DB retention, worker capacity and candidate-volume tuning. store:false is used for Responses; it does not imply provider Batch/files are retained for zero time. No destructive cleanup is included.
