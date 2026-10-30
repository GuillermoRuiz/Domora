# Worker/operator runbook

Every 15 seconds one job/replica is claimed by CAS with five-minute lease/30-second heartbeat. Fenced writes reject stale workers. Bounded backoff stops at five attempts. Recovery marks exhausted leases failed, requeues pending uploads. Errors are sanitized. Database tables are durable state; timers are not.

Cron: weekly `0 0 0 * * 6`, timezone Europe/Madrid; recovery `0 */10 * * * *`; Batch submit `0 * * * * *`, poll `30 * * * * *`; accounting `0 15 * * * *`. Oldest-update rotation avoids one slow batch blocking others. Local preparing batches recover persisted inputs.

Start staging with worker true, AI false, auto reconciliation false. Verify deterministic flows. Enable AI only with explicit compatible model/server key. Actual vendor/schema/vision/PDF/Batch compatibility requires approved staging fixtures/budget; not tested live here. Runtime prompt/schema assets must be copied by Nest into dist (21 files).

Inspect jobs, AiAudit, AiRequest and AiBatch. Retry failed non-send jobs only after cause correction; successful output replay is safe. submission_unknown: search project batches by metadata.domora_batch; reviewed adoption of matching ID permits polling. Never blindly reset uncertain remote submissions. sending >10min/unknown: inspect SMTP Message-ID acceptance logs; never reset ready without delivery verification.

Weekly failure retains old result. Retry failed request/job after fixing cause; adopt uncertain batch. Recovery builds current week only. Preserve completed records during retries.

REQUIRES DEVELOPER DECISION: alerts for pending age, failed/exhausted jobs, unknown SMTP/Batch, usage, schema failures, dense accounting windows, stale weekly result. Code provides safe warnings/durable audit; no observability service was invented. Throughput defaults one serial feature job/replica; batches <=100 items/10 MB. Large estates require reviewed capacity/windows/pagination.

Rollback: disable AI/workers first, revert imports/panels/patches, keep tables/files for audit. Destructive down SQL needs backup/retention approval. Keep originals linked to existing SupplierInvoice attachments; never remove shared storage or original accounting records.
