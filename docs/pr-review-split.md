# Separation of PR 17

The replacement reviews form a stack. Review each branch against its immediate
parent; merge in this order:

Published reviews: [Reports #19](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/19),
[Dropdowns #20](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/20),
[Menu #21](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/21),
[Operations #22](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/22).
The original [PR #17](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/17)
remains as a draft with links to these replacements and all original comments.
All four replacement PRs report merge-status `succeeded` (no conflicts); this is
not a CI result or approval to merge. Exact titles/descriptions/targets were read
back and verified after publication.

| Block | Branch | Target | Scope |
|---|---|---|---|
| Reports | `review/reports-safe-migrations` | `main` | Reports UI/API, domain foundations, snapshots, five reviewed migrations, CI setup |
| Dropdowns | `review/dropdowns` | `review/reports-safe-migrations` | Shared dropdown behaviour, existing select integration, coverage gate |
| Menu | `review/navigation-shell` | `review/dropdowns` | Role navigation, account header, transparent logo, navigation tests |
| Operations | `review/operations-workspaces` | `review/navigation-shell` | Global meetings/incidents, estate context and equal empty-state heights |

Reports includes the unchanged `_dropdown-panel.scss` mixins from `457a75d`
because its community selector imports them. Behaviour/directives and the global
dropdown migration remain in the second review. The original `bru_sidemenu` and
`bru_informes` histories are preserved. Pending community-header changes for
Reports/Tasks remain in the original working tree.

After a parent is merged using squash, reconstruct/rebase its child on the
resulting `main` commit before retargeting. Retargeting alone can reintroduce the
parent's diff. Do not merge children out of order or force-push original branches.

## Migration review (PR 18 threads 29/30, inherited by PR 17)

`20261015190000_restore_ai_tenant_guards` now creates the function only when
absent. It compares an existing body with the published source at
`bc64b89aefc64aacb7d1a49d8266e8d719768c3f`, including execution/security attributes.
Only CRLF/LF is normalized; unknown definitions fail with a descriptive error.
Existing triggers must match the function, row/before/insert/update events,
enabled state, arguments and predicate. All DDL is transactional. Unknown objects
are preserved for manual review; no `CREATE OR REPLACE` or `CASCADE` is used.

`20261015200000_align_notification_category_order` retains its historical name
but only validates labels. There is no application requirement for PostgreSQL's
enum ordering: inbox queries sort by creation time and preferences use the
generated enum's explicit presentation order. Legacy order is therefore accepted.
The migration never replaces a type or rewrites rows, preserving every dependency
including defaults, array types, views and functions. PostgreSQL enum order still
affects range/comparison operations; this decision is specific to this enum's use
in Domora. Schema audits must allow this intentional order difference.

These two SQL files were introduced by the unmerged reports work. Their revised
checksums differ from the earlier local verification recorded in
`reporting-local-verification.md`; that document is a historical record, not the
current migration implementation. No existing database schema or `_prisma_migrations`
row was modified during this review. Browser checks only add normal session/audit
effects through the API. Do not silently resolve/reset checksums in
an environment that applied the previous PR SQL: retain its original history and
plan an explicit forward reconciliation after inspecting that environment.

The other three migrations remain unchanged: additive reporting foundations,
snapshot storage, and the documented legacy AI schema reconciliation. No seed or
legacy alias resolution should run against an unreviewed environment.

## Reproducible safety test

From `backend`, generate Prisma Client, then set `MIGRATION_TEST_ADMIN_URL` to a
local PostgreSQL `/postgres` maintenance database (use `127.0.0.1`, not `localhost`, on Windows) and run
`npm run test:migration-safety`. The role needs CREATE DATABASE and permission to
install `btree_gist`. The test refuses remote hosts, never reads `DATABASE_URL`,
creates unique databases, replays the complete SQL chain and drops only databases
it created. The CI backend job runs it against its local PostgreSQL service.

Coverage: fresh replay; known legacy function/trigger preservation; unknown body,
disabled trigger and security-definer rejection; all enum values in populated
notifications/preferences under canonical and legacy order; preserved OID,
dependencies, defaults, arrays, views/functions; unexpected-label rejection;
valid and cross-tenant INSERT/UPDATE across all five guarded AI tables, including
supplier, issue/canonical issue, bank, statement entry, journal line and invoice.
Failed operations must return SQLSTATE 23514 and leave the valid row in place.

Rollback: label validation has no effects. A rejected guard migration rolls back
the entire transaction. A successfully installed guard is a security protection;
application rollback must retain it. Only a reviewed environment-specific rollback
may remove newly created guards; never drop a pre-existing function/trigger.

References: [PostgreSQL enums](https://www.postgresql.org/docs/current/datatype-enum.html),
[dependencies](https://www.postgresql.org/docs/current/catalog-pg-depend.html).

## Reports validation (17/10)

- Angular production build and backend build (including Prisma generation): pass.
- Angular: 150 suites, 1545 tests pass. The estate navigation fixture now answers
  the governance request on initial load and when returning to the properties tab.
- Real-PostgreSQL reports/domain tests: 16 suites, 92 tests pass in a unique fresh
  database created with all 75 migrations via `prisma migrate deploy`.
- Migration regression suite: six tests pass after reproducing the original
  unknown-function, disabled-trigger and populated-legacy-enum failures.
- Static independent review: no Critical/Required findings in the migration fixes.
- Existing Angular component size/unused-import warnings remain; no remote CI or
  production deployment is claimed by these local results.

## Stack validation (17/10)

| Branch | Angular production build | Frontend tests | Additional checks |
|---|---|---|---|
| Reports | Pass | 1545 / 150 suites | Backend build; 92 backend/domain tests; six migration tests |
| Dropdowns | Pass | 1563 / 151 suites | Select-directive coverage gate |
| Menu | Pass | 1579 / 153 suites | Inherits unchanged backend/migrations |
| Operations | Pass | 1599 / 156 suites | Backend compilation; five backend tests; select coverage; five Chromium scenarios |

Operations now imports `SelectDropdownDirective`; the coverage test reproduced
its absence before the correction. The browser test selects a community through
the shared popup. The old Intelligence fixture now opens Documents (still inside
Fincas); issue redirects are verified by the dedicated routing and browser tests.

The browser run uses the actual production build with a local same-origin API
proxy, without altering the user's API/CORS settings. Its isolated test context
blocks service workers so the two response-fixture scenarios remain interceptable.
The other three scenarios use real API data, navigation and forms. Dark/light
screenshots cover 320/1440 px; the real operations flow also checks 640/900 px.

An independent final review found no Required/Critical issues or lost files.
The comparison against `84c615b` differs only in the reviewed fixes, regression
tests/CI/docs and shared dropdown integration. Original local header work retains
SHA-256 `4E3F6DB339410C95DD4F312DECC01F63147D4958B07D8AA85B416FFA26060194`.
