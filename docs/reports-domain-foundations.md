# Reporting domain foundations

The additive `20261015160000_reporting_domain_foundations` migration preserves
existing rows. It neither resets data nor reconstructs unknown dates or costs.

## Community officers

`EstateOfficeTerm` stores the officer's name snapshot and historical association
IDs. The current president has `startsAt <= businessDate` and either no end or
`endsAt > businessDate`. Dates are UTC business days; intervals are half-open
`[startsAt, endsAt)`. A succession on 15 October ends the previous mandate on
15 October and begins the new one that day.

The PostgreSQL `estate_president_no_overlap` exclusion constraint protects both
open and finite mandates, including concurrent writes and future appointments.
It reuses the `btree_gist` extension already required by bookings and interest
policies. An estate row lock serializes replacements. Appointment and predecessor
termination share one transaction; a conflicting future term rolls both back.

The governance API lives at `/api/v1/estates/:estateId/office-terms` (GET/POST),
`/candidates` (GET) and `/:termId/end` (PATCH). It rereads the actual user role,
administrator and estate access from PostgreSQL on every request. JWT estate IDs
and administrator claims do not grant access. Referenced properties, memberships,
external owners and meetings must belong to the authorized estate. When a linked
holder is selected, the server obtains their name; a submitted replacement name
cannot overwrite that authoritative snapshot.

Property, holder, meeting and actor IDs are logical historical references,
without cascading foreign keys. This follows existing historical-reference
patterns in the repository and preserves snapshots after source record removal.
The estate relationship is a restrictive FK. The service verifies associations
before writing. Deleting a source does not delete the officer history.

The Finca Properties tab contains a compact **Órganos de gobierno** section for
current president, linked property reference, appointments, end dates and history.

## Incident lifecycle

`Issue.resolvedAt` and `closedAt` describe the current lifecycle. Entering
`Resuelta` sets `resolvedAt`; entering `Cerrada` sets `closedAt` without inventing
a resolution when it was closed directly. Reopening to an open operational state
clears both current markers. Resolving again sets a new current resolution.

`IssueTimelineEntry` gains nullable `fromStatus` and `toStatus`. Its existing
`date` and `authorUserId` are the event instant and actor. State changes, markers
and structured events are written atomically under an issue row lock. A repeated
identical status does not create a duplicate transition. Previous event rows
remain available after reopen. Free-text timeline entries have both status
columns NULL; a DB check requires both columns for a transition.

Existing issues and historical text entries are not backfilled. Duration reports
must use structured events and state their legacy coverage, never `updatedAt` or
parsing timeline prose. No SLA policy has been invented.

## Contract costs

Contracts have nullable `costAmount` (`Decimal(12,2)`) and `costFrequency`, plus
`currency` defaulting to EUR. Both current create and edit flows maintain these
fields. Zero is a valid cost; negative amounts, excess precision and invalid ISO
currencies are rejected. Legacy missing costs remain unknown.

Annualized cost is only defined for MONTHLY ×12, QUARTERLY ×4, SEMIANNUAL ×2 and
ANNUAL ×1. ONE_OFF, OTHER, missing amount and missing frequency return unknown.
No currency conversion is performed. Future contracts are `Programado`, not
active. Start/end comparisons use UTC business dates; the contract end business
date remains inclusive, preserving the contract date meaning.

## Receipt issuance

`AccountingReceipt.issuedAt` is an explicit nullable emission instant, independent
of accounting accrual and the legacy mutable `date`. Native Domora emissions set
it when issued. Imports of pre-existing documents explicitly pass NULL; opening
balance receipts also retain NULL. No legacy `createdAt`, accrual date or due date
has been used as an invented historical emission instant.

## Audit storage

Existing `DataAccessLog` gains nullable JSON metadata for allowlisted technical
reporting audit facts. No parallel report-audit table is created. Report content
and personal identifiers do not belong in this metadata.

## Verification

New tests cover fresh governance scope, snapshot preservation, succession,
PostgreSQL overlap/date constraints, structured incident transitions and reopen,
receipt emission versus import dates, contract status and annualization, cost
validation, and the real maintenance UI/API flows.

Integration specs require a migrated disposable PostgreSQL database. They create
unique tenants and delete only their own fixtures. PGlite wire adapters can retain
prepared statements across client sessions: use a dedicated instance per suite
process and clear adapter prepared statements between processes. This limitation
is not a reason to disable PostgreSQL constraints.
