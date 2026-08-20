# CRM Production Hardening Design

## Scope

This design completes the existing CRM middle-office capabilities except for real online payment callbacks and automated payout-provider integration.

Included:

- Cross-system quota-operation idempotency and recovery.
- Transactional CRM financial writes.
- Concurrent withdrawal protection.
- Complete commission release and withdrawal allocation accounting.
- Conditional financial state transitions.
- New API shadow-identity refresh.
- Complete audit context for supported CRM mutations.
- Role-aware CRM navigation.
- Versioned CRM schema migrations.
- Observable scheduler health.

Excluded:

- Real online payment-provider callbacks.
- Automated bank, Alipay, or WeChat payouts.
- Payment-provider reconciliation APIs.

## Architecture

The existing `crm_account_events` state machine remains the single coordinator for CRM-initiated New API quota changes. Signup trial grants and refunds become explicit account-event types instead of maintaining separate check-then-call flows.

MySQL repositories expose a transaction boundary that returns a repository bound to one connection. Local effects for an account event execute inside one transaction. Financial aggregates and state transitions use row locks or conditional updates so concurrent requests cannot consume the same balance or overwrite a completed review.

Cross-system quota changes cannot be made exactly-once unless New API supports an idempotency key. CRM therefore uses an explicit ambiguity state:

```text
pending
  -> quota_applying
  -> quota_applied
  -> local_applying
  -> completed

quota_applying/local failure
  -> reconcile_required
  -> local_applying -> completed   (operator confirms quota applied)
  -> cancelled                    (operator confirms quota not applied)
```

CRM never automatically repeats an ambiguous external quota call. An operator must resolve it through the existing account-event reconciliation workflow.

## Account Events

Add account-event types:

- `signup_trial_grant`
- `refund`

Each event stores its business payload in `metadata_json`:

- Trial grant: CRM user ID and New API user ID.
- Refund: source account-event ID.

The event idempotency keys remain stable:

- `signup-trial:<crmUserId>`
- `account-event-refund:<sourceAccountEventId>`

The event's local-effect handler branches by event type:

- Standard paid top-up: update paid totals, ledger, commissions, discount, effective-customer candidate, and audit.
- Compensation or exception adjustment: update ledger and audit without paid commission.
- Trial grant: write a `signup_trial_grant` ledger entry, mark the trial grant completed, and audit.
- Refund: write a refund ledger entry, reduce cumulative paid value, claw back unreleased source commissions, refresh the source effective-customer candidate, and audit.

All local effects run inside one database transaction. A failure rolls back every local write. `local_applying` is safe to replay because no partial local effects can remain committed.

## Reconciliation

The reconciliation endpoint accepts events in `reconcile_required`, stale `quota_applying`, and stale `local_applying` states.

Supported operator actions:

- `confirm_quota_applied`: move the event to local application and commit local effects.
- `cancel`: mark the event cancelled because the operator verified that New API quota did not change.

The UI must describe that cancellation is only valid after checking New API. It must not offer an automatic external retry for ambiguous events.

## Withdrawals And Commissions

Withdrawal creation executes in a transaction that locks the beneficiary CRM user row, recalculates commission availability, checks active risk blocks, and inserts the pending withdrawal. Two concurrent requests cannot both spend the same available amount.

Pending and approved withdrawals reserve commission availability. Paid withdrawals no longer remain part of the reservation calculation because their amount is reflected in commission `released_amount_rmb`.

Add `crm_withdrawal_commission_allocations`:

- `withdrawal_id`
- `commission_id`
- `amount_rmb`
- timestamps
- unique `(withdrawal_id, commission_id)`

When an approved withdrawal is marked paid, CRM locks the withdrawal and beneficiary commission rows, allocates the withdrawal FIFO from releasable commission balances, writes allocation rows, increments `released_amount_rmb`, and marks fully consumed commissions `released`. The withdrawal update, allocation, withdrawal ledger entry, and audit log commit in one transaction.

Commission release, block, and clawback transitions use explicit allowed transitions and conditional SQL updates. Clawback only applies to the unreleased portion. A fully released commission cannot be clawed back through the current manual action.

## Ledger Consistency

Every ledger insert locks the related CRM user row before calculating `balance_after_rmb`. The calculation and insert occur on the same transaction connection. This prevents two concurrent entries from storing the same starting balance.

The unique idempotency key remains the final duplicate-write guard.

## Identity Synchronization

Every signed embedded request refreshes the existing CRM shadow user's:

- Sanitized username.
- Email.
- `new_api_role`.

Username collision handling retains the stable `_na<newApiUserId>` suffix. CRM authorization continues to use the signed live role, while lists and dashboard counts use the refreshed shadow role.

## Audit Context

An async request context captures:

- Forwarded or socket request IP.
- User-Agent.

Repository audit writes include this context automatically. Existing domain calls do not need to pass transport data through every function.

The following mutations must create audit records with before/after snapshots where meaningful:

- Settings updates.
- Offline recharge approval and rejection.
- Attachment upload.
- Commission transitions.
- Withdrawal transitions and payment allocation.
- Enterprise settlement transitions.
- Risk case changes.
- User and agent changes.
- Account-event reconciliation, cancellation, and refund.

## Navigation

CRM sidebar group resolution receives the current New API role. Users below the super-admin role see only the distribution-center group. Super admins see the platform-management group and may retain the distribution group only when explicitly required by product navigation; the default is platform management only, matching section resolution.

Backend authorization remains authoritative.

## Schema Migrations

Add `crm_schema_migrations` with a unique migration name and applied timestamp. Migration execution becomes ordered and records each completed migration.

The existing clean schema becomes the baseline migration. A following migration creates withdrawal commission allocations and any new indexes required for conditional financial operations. Existing databases can run the migration command repeatedly without losing data.

## Scheduler Health

Each background scheduler tracks:

- Enabled state and interval.
- Running state.
- Last start time.
- Last successful completion time.
- Last failure time and stable failure message.

`GET /health` exposes this state so external monitoring can alert on stale or failing maintenance work. Logs remain available for diagnostics but are not the only monitoring interface.

## Error Handling

- Ambiguous New API results become `reconcile_required`; they are never silently retried.
- Conditional state-update conflicts return HTTP 409 with stable CRM error codes.
- Transaction failures return sanitized internal errors and leave no partial local financial writes.
- Insufficient commission during withdrawal creation or payout allocation returns a stable balance error.
- Audit failure inside a financial transaction fails and rolls back the financial mutation.

## Testing

Tests are written before implementation and must demonstrate the pre-fix failure.

Required backend coverage:

- Concurrent trial-grant calls result in one New API quota call.
- Concurrent refund calls result in one New API quota call.
- Failed local account-event effects leave no partial profile, ledger, commission, or audit writes.
- `local_applying` and confirmed `quota_applying` events can be recovered.
- Concurrent withdrawals cannot exceed available commission.
- Paid withdrawals allocate commissions FIFO and update released amounts.
- Invalid concurrent financial state transitions return conflicts.
- Embedded requests refresh stored role and identity fields.
- Audit records include request IP and User-Agent.
- Versioned migrations are repeatable.
- Scheduler health reports success and failure.

Required frontend coverage:

- Trial and account-event reconciliation actions match the new state model.
- Ordinary users do not receive platform-management navigation groups.
- Super admins receive the correct CRM navigation.

Verification commands:

```bash
pnpm --filter @ai-native/crm-contracts check
pnpm --filter @ai-native/crm-api check
cd services/ai-gateway/new-api/web/default
bun run typecheck
bun test \
  src/features/crm/section.test.ts \
  src/features/crm/operations-coverage.test.ts \
  src/components/layout/lib/sidebar-view-registry.test.ts
cd ../../../../../..
pnpm run verify:workspace
pnpm run check
pnpm run build
```

When a local MySQL instance is available, transaction and concurrency integration tests must also run against MySQL rather than only the memory repository.

## Completion Criteria

The hardening is complete when:

- No CRM quota mutation uses an unclaimed check-then-call flow.
- Every multi-row local financial effect is transactional and recoverable.
- Concurrent withdrawals cannot overspend commission.
- Paid withdrawals update commission released amounts and allocation records.
- Shadow identity and navigation reflect the current New API role.
- Supported mutations produce attributable audit records.
- Migrations are repeatable on existing databases.
- Scheduler health is externally observable.
- All repository checks, frontend checks, and the unified build pass.
