# CRM Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing CRM middle office production-safe and complete, excluding real payment callbacks and automated payout-provider integration.

**Architecture:** Reuse `crm_account_events` as the single New API quota-operation state machine, execute local financial effects through a connection-bound repository transaction, and add explicit conditional transitions and commission allocation records. Keep New API as the identity and quota fact source while improving CRM auditability, migrations, navigation, and scheduler observability.

**Tech Stack:** TypeScript, Node.js HTTP, mysql2/promise, Node test runner, React 19, TanStack Query/Router, Bun, Go New API proxy.

---

## File Map

- `packages/crm-contracts/src/index.ts`: shared event, allocation, audit, health, and DTO contracts.
- `packages/crm-contracts/src/index.test.ts`: contract invariants.
- `services/crm-api/src/types.ts`: repository transaction and financial-operation interfaces.
- `services/crm-api/src/db/migrations.ts`: ordered schema migrations and allocation table.
- `services/crm-api/src/db/migrations.test.ts`: repeatable migration behavior.
- `services/crm-api/src/db/mysql.ts`: connection-bound repository, locks, conditional updates, allocation persistence, identity refresh, audit context persistence.
- `services/crm-api/src/test-helpers/repository.ts`: memory implementation of new repository contracts.
- `services/crm-api/src/domain/account-events.ts`: unified trial, refund, reconciliation, and transactional local effects.
- `services/crm-api/src/domain/trial-balance.ts`: trial-grant adapter over account events.
- `services/crm-api/src/domain/commission-ledger.ts`: released and clawback ledger amounts.
- `services/crm-api/src/routes/agent-dashboard.ts`: atomic withdrawal creation.
- `services/crm-api/src/routes/withdrawals.ts`: transactional payout allocation.
- `services/crm-api/src/routes/commissions.ts`: allowed commission transitions.
- `services/crm-api/src/routes/offline-recharges.ts`: conditional review and audit.
- `services/crm-api/src/routes/settings.ts`: settings audit.
- `services/crm-api/src/routes/attachments.ts`: attachment audit metadata.
- `services/crm-api/src/request-context.ts`: request IP and User-Agent context.
- `services/crm-api/src/scheduler-health.ts`: scheduler health state.
- `services/crm-api/src/server.ts`: embedded identity refresh, request context, reconciliation actions, health response.
- `services/ai-gateway/new-api/web/default/src/components/layout/config/crm.config.ts`: role-aware CRM navigation groups.
- `services/ai-gateway/new-api/web/default/src/components/layout/lib/sidebar-view-registry.ts`: role-aware group resolution.
- `services/ai-gateway/new-api/web/default/src/hooks/use-sidebar-view.ts`: pass current role into sidebar resolution.
- `services/ai-gateway/new-api/web/default/src/features/crm/index.tsx`: reconciliation UI and updated commission labels.

### Task 1: Extend Shared Contracts

**Files:**
- Modify: `packages/crm-contracts/src/index.ts`
- Modify: `packages/crm-contracts/src/index.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add assertions that the account-event contract exposes trial and refund operations and that withdrawal allocations are typed:

```ts
assert.equal(accountEventTypes.signupTrialGrant, "signup_trial_grant");
assert.equal(accountEventTypes.refund, "refund");

const allocation: WithdrawalCommissionAllocationDto = {
  id: 1,
  withdrawalId: 2,
  commissionId: 3,
  amountRmb: 12.34,
  createdAt: "2026-07-11T00:00:00.000Z"
};
assert.equal(allocation.amountRmb, 12.34);
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm --filter @ai-native/crm-contracts test
```

Expected: TypeScript or runtime failure because the new event types and DTO do not exist.

- [ ] **Step 3: Add the minimal contracts**

Add:

```ts
export const accountEventTypes = {
  adminPaidTopup: "admin_paid_topup",
  compensationGrant: "compensation_grant",
  exceptionAdjustment: "exception_adjustment",
  onlineTopup: "online_topup",
  signupTrialGrant: "signup_trial_grant",
  refund: "refund"
} as const;

export interface WithdrawalCommissionAllocationDto {
  id: number;
  withdrawalId: number;
  commissionId: number;
  amountRmb: number;
  createdAt?: string;
}
```

Extend audit DTOs with optional `requestIp` and `userAgent`. Add scheduler-health DTOs with enabled, interval, running, last-start, last-success, last-failure, and failure-message fields.

- [ ] **Step 4: Run contract check and verify GREEN**

```bash
pnpm --filter @ai-native/crm-contracts check
```

Expected: all contract tests and typecheck pass.

### Task 2: Add Versioned Schema Migrations

**Files:**
- Modify: `services/crm-api/src/db/migrations.ts`
- Modify: `services/crm-api/src/db/migrations.test.ts`

- [ ] **Step 1: Write failing migration tests**

Test that migrations have stable names, include a migration ledger, create allocation storage, and skip already-applied names:

```ts
const migrations = getCrmMigrations();
assert.deepEqual(migrations.map((migration) => migration.name), [
  "001_initial_crm_schema",
  "002_withdrawal_commission_allocations"
]);
assert.match(migrations[1].statements.join("\n"), /crm_withdrawal_commission_allocations/);
assert.match(migrations[1].statements.join("\n"), /UNIQUE KEY uq_withdrawal_commission/);
```

- [ ] **Step 2: Run migration tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/db/migrations.test.ts
```

Expected: `getCrmMigrations` is missing.

- [ ] **Step 3: Implement ordered migrations**

Introduce:

```ts
export interface CrmMigration {
  name: string;
  statements: string[];
}

export function getCrmMigrations(): CrmMigration[] {
  return [
    { name: "001_initial_crm_schema", statements: getInitialSchemaStatements() },
    {
      name: "002_withdrawal_commission_allocations",
      statements: [`CREATE TABLE IF NOT EXISTS crm_withdrawal_commission_allocations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        withdrawal_id BIGINT UNSIGNED NOT NULL,
        commission_id BIGINT UNSIGNED NOT NULL,
        amount_rmb DECIMAL(12,2) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_withdrawal_commission (withdrawal_id, commission_id),
        KEY idx_withdrawal_allocations_commission (commission_id)
      )`]
    }
  ];
}
```

`runMigrations` must create `crm_schema_migrations`, read applied names, run each missing migration in order, and insert its name only after all statements succeed.

- [ ] **Step 4: Run migration tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/db/migrations.test.ts
```

Expected: migration tests pass.

### Task 3: Introduce Connection-Bound Repository Transactions

**Files:**
- Modify: `services/crm-api/src/types.ts`
- Modify: `services/crm-api/src/db/mysql.ts`
- Modify: `services/crm-api/src/db/mysql.test.ts`
- Modify: `services/crm-api/src/test-helpers/repository.ts`

- [ ] **Step 1: Write failing transaction and lock tests**

Add tests for the repository contract and SQL behavior:

```ts
assert.equal(typeof repository.withTransaction, "function");
```

Add a unit seam around the MySQL executor and assert that a transactional ledger insert issues:

```text
SELECT id FROM crm_users WHERE id = ? FOR UPDATE
SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_rmb ELSE -amount_rmb END), 0) AS balance FROM crm_ledger_entries WHERE crm_user_id = ?
INSERT INTO crm_ledger_entries (crm_user_id, direction, amount_rmb, paid_amount_rmb, discount_amount_rmb, commission_base_rmb, balance_after_rmb, event_type, source_type, source_id, idempotency_key, operator_crm_user_id, reason, is_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

in that order on one executor.

- [ ] **Step 2: Run the repository tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/db/mysql.test.ts
```

Expected: transaction API and lock behavior are missing.

- [ ] **Step 3: Add repository transaction types**

Add to `CrmRepository`:

```ts
withTransaction<T>(work: (repository: CrmRepository) => Promise<T>): Promise<T>;
```

Refactor MySQL construction around a `QueryExecutor` implemented by both `Pool` and `PoolConnection`. Top-level `withTransaction` obtains a connection, begins a transaction, builds a connection-bound repository, commits on success, rolls back on failure, and always releases the connection. Nested calls on a connection-bound repository execute the callback directly.

`insertLedgerEntry` must start a transaction when called on the pool repository. Inside a transaction it locks the CRM user row before calculating and inserting `balance_after_rmb`.

The memory repository implements `withTransaction` directly for normal tests. Transaction rollback behavior is tested with an explicit transactional fake rather than pretending that the in-memory repository provides database isolation.

- [ ] **Step 4: Run repository tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/db/mysql.test.ts
```

Expected: all MySQL repository tests pass.

### Task 4: Make Account-Event Local Effects Transactional And Recoverable

**Files:**
- Modify: `services/crm-api/src/domain/account-events.ts`
- Modify: `services/crm-api/src/domain/account-events.test.ts`
- Modify: `services/crm-api/src/db/mysql.ts`
- Modify: `services/crm-api/src/test-helpers/repository.ts`

- [ ] **Step 1: Write failing rollback and recovery tests**

Add a transactional fake that throws after profile update and assert no profile, ledger, commission, or audit writes remain. Add tests that `local_applying` can be replayed and that confirmed `quota_applying` can move to local application.

```ts
await assert.rejects(() => createAccountEvent(input), /forced local failure/);
assert.equal(await repository.listLedger({ page: 1, pageSize: 10 }).then((page) => page.total), 0);
assert.equal((await repository.getUserProfile(user.id)).cumulativePaidRmb, 0);
```

- [ ] **Step 2: Run account-event tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/account-events.test.ts
```

Expected: partial local writes remain or recovery rejects `local_applying`.

- [ ] **Step 3: Implement transactional local effects**

Wrap `applyAccountEventLocalEffects` in:

```ts
return repository.withTransaction(async (transactionRepository) => {
  return applyAccountEventLocalEffectsWithinTransaction({
    repository: transactionRepository,
    localRecord,
    operatorCrmUserId,
    reason,
    auditAction
  });
});
```

Rename the current local-effect body to `applyAccountEventLocalEffectsWithinTransaction`; it performs the existing profile, ledger, commission, effective-customer, audit, and completion calls using only the supplied transaction-bound repository.

If local application fails, conditionally mark the event `reconcile_required` after rollback. Extend reconciliation so:

- `local_applying` replays local effects.
- `quota_applying` with `confirm_quota_applied` first moves to `quota_applied` without another New API call.
- `cancel` conditionally cancels only supported unresolved states.

Every state update must return `didMutate`; failure becomes a 409 conflict.

- [ ] **Step 4: Run account-event tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/account-events.test.ts
```

Expected: rollback and recovery tests pass.

### Task 5: Route Trial Grants Through Account Events

**Files:**
- Modify: `services/crm-api/src/domain/trial-balance.ts`
- Create: `services/crm-api/src/domain/trial-balance.test.ts`
- Modify: `services/crm-api/src/server.test.ts`
- Modify: `services/crm-api/src/server.ts`

- [ ] **Step 1: Write the concurrent trial-grant regression test**

Use a barrier in `manageUserQuota` and invoke two grants for the same CRM user:

```ts
const results = await Promise.allSettled([
  grantSignupTrialBalance(input),
  grantSignupTrialBalance(input)
]);
assert.equal(quotaCalls, 1);
assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/trial-balance.test.ts
```

Expected: `quotaCalls` is 2.

- [ ] **Step 3: Implement the trial account event**

`grantSignupTrialBalance` calls `createAccountEvent` with:

```ts
{
  eventType: accountEventTypes.signupTrialGrant,
  crmUserId,
  operatorCrmUserId,
  amountRmb: signupTrialGrantRmb,
  idempotencyKey: signupTrialGrantIdempotencyKey(crmUserId),
  reason: "new user trial balance granted by CRM",
  metadata: { newApiUserId }
}
```

The local-effect branch writes a `signup_trial_grant` ledger row and marks `signup_trial_grant_status=granted` inside the transaction. Existing ambiguous events return reconciliation-required without repeating quota.

- [ ] **Step 4: Run trial and server tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/trial-balance.test.ts src/server.test.ts
```

Expected: one quota call and all session/retry tests pass.

### Task 6: Route Refunds Through Account Events

**Files:**
- Modify: `services/crm-api/src/domain/account-events.ts`
- Modify: `services/crm-api/src/domain/account-events.test.ts`
- Modify: `services/crm-api/src/routes/account-events.ts`
- Modify: `services/crm-api/src/server.test.ts`

- [ ] **Step 1: Write concurrent and partial-failure refund tests**

Invoke two refunds against one completed paid event with a blocked quota client and assert one quota call. Force a local-effect failure after quota application and assert the refund event becomes reconcilable without partial local refund rows.

- [ ] **Step 2: Run refund tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/account-events.test.ts src/server.test.ts
```

Expected: duplicate quota subtraction or partial refund state.

- [ ] **Step 3: Implement refund events**

Create a `refund` account event with stable key `account-event-refund:<sourceId>`, negative quota amount, and source-event metadata. The refund local-effect branch must transactionally:

```ts
await repository.saveUserProfile(updateRefundedPaidEventProfile(profile, sourceEvent));
await repository.insertLedgerEntry({
  crmUserId: sourceEvent.crmUserId,
  direction: ledgerDirections.debit,
  amountRmb: Math.abs(sourceEvent.amountRmb),
  paidAmountRmb: Math.abs(sourceEvent.paidAmountRmb),
  discountAmountRmb: Math.abs(sourceEvent.discountAmountRmb),
  commissionBaseRmb: Math.abs(sourceEvent.commissionBaseRmb),
  eventType: ledgerEventTypes.refund,
  sourceType: "account_event",
  sourceId: sourceEvent.id,
  idempotencyKey: refundEvent.idempotencyKey,
  operatorCrmUserId,
  reason,
  isPaid: true
});
await clawBackRefundedEventCommissions({
  repository,
  sourceEvent,
  operatorCrmUserId,
  reason
});
await refreshRefundedEffectiveCustomers({ repository, sourceEvent });
await repository.insertAuditLog({
  operatorCrmUserId,
  targetType: "account_event",
  targetId: sourceEvent.id,
  action: "account_event.refund",
  reason,
  before: sourceEvent,
  after: refundEvent
});
await repository.completeAccountEvent(refundEvent.id, {
  quotaDelta: refundEvent.quotaDelta,
  newApiResult: refundEvent.newApiResult
});
```

Define `clawBackRefundedEventCommissions` and `refreshRefundedEffectiveCustomers` in `account-events.ts` by moving the existing refund loops into named functions that accept the transaction-bound repository shown above.

Remove the old direct check-then-quota-call refund implementation.

- [ ] **Step 4: Run refund tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/domain/account-events.test.ts src/server.test.ts
```

Expected: refund concurrency and recovery tests pass.

### Task 7: Make Withdrawal Reservation Atomic

**Files:**
- Modify: `services/crm-api/src/types.ts`
- Modify: `services/crm-api/src/db/mysql.ts`
- Modify: `services/crm-api/src/test-helpers/repository.ts`
- Modify: `services/crm-api/src/routes/agent-dashboard.ts`
- Modify: `services/crm-api/src/routes/agent-dashboard.test.ts`

- [ ] **Step 1: Write a concurrent withdrawal test**

Release 250 RMB of commission and concurrently submit two 160 RMB withdrawals. Assert only one is created and the other returns `withdrawal_insufficient_balance`.

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/routes/agent-dashboard.test.ts
```

Expected: both withdrawals are accepted.

- [ ] **Step 3: Add atomic withdrawal creation**

Add repository method:

```ts
createWithdrawalWithBalanceCheck(input: WithdrawalCreateInput): Promise<WithdrawalDto>;
```

The MySQL method starts a transaction, locks the beneficiary `crm_users` row, calculates remaining releasable commission and pending/approved withdrawal reservations, checks active user withdrawal risk, and inserts only when sufficient.

The route performs input validation and delegates the financial decision to this repository method.

- [ ] **Step 4: Run withdrawal tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/routes/agent-dashboard.test.ts
```

Expected: one concurrent request succeeds and one fails with a stable balance error.

### Task 8: Complete Commission Release And Withdrawal Allocation

**Files:**
- Modify: `services/crm-api/src/types.ts`
- Modify: `services/crm-api/src/db/mysql.ts`
- Modify: `services/crm-api/src/test-helpers/repository.ts`
- Modify: `services/crm-api/src/routes/withdrawals.ts`
- Modify: `services/crm-api/src/routes/commissions.ts`
- Modify: `services/crm-api/src/domain/commission-ledger.ts`
- Modify: `services/crm-api/src/routes/admin-operations.test.ts`
- Modify: `services/crm-api/src/routes/agent-dashboard.test.ts`

- [ ] **Step 1: Write failing FIFO allocation and transition tests**

Create two releasable commissions, pay a withdrawal spanning both, and assert allocations consume the oldest commission first, update released amounts, and mark fully consumed rows released. Add invalid transition tests such as blocked-to-releasable and released-to-clawed-back.

- [ ] **Step 2: Run operation tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/routes/admin-operations.test.ts src/routes/agent-dashboard.test.ts
```

Expected: no allocations exist and released amounts remain zero.

- [ ] **Step 3: Implement allocation and conditional transitions**

Add repository operations that, in one transaction:

```ts
markWithdrawalPaidWithAllocations(input): Promise<{
  withdrawal: WithdrawalDto;
  allocations: WithdrawalCommissionAllocationDto[];
}>;
```

Lock the approved withdrawal and releasable commissions ordered by `created_at, id`. Allocate `commission_amount_rmb - released_amount_rmb`, insert allocation rows, increment released amounts, set fully consumed commissions to `released`, insert the withdrawal ledger entry, and insert audit.

Commission transitions must use conditional SQL such as:

```sql
UPDATE crm_commissions
SET status = ?
WHERE id = ? AND status = ? AND released_amount_rmb = 0
```

Allowed transitions:

```text
frozen -> releasable
frozen -> blocked
releasable -> blocked
frozen/releasable/blocked -> clawed_back only when released_amount_rmb = 0
```

- [ ] **Step 4: Run operation tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/routes/admin-operations.test.ts src/routes/agent-dashboard.test.ts
```

Expected: FIFO allocation, summaries, and transition conflicts pass.

### Task 9: Refresh Embedded Identity And Complete Audit Context

**Files:**
- Create: `services/crm-api/src/request-context.ts`
- Create: `services/crm-api/src/request-context.test.ts`
- Modify: `services/crm-api/src/types.ts`
- Modify: `services/crm-api/src/db/mysql.ts`
- Modify: `services/crm-api/src/test-helpers/repository.ts`
- Modify: `services/crm-api/src/server.ts`
- Modify: `services/crm-api/src/server.test.ts`
- Modify: `services/crm-api/src/routes/settings.ts`
- Modify: `services/crm-api/src/routes/offline-recharges.ts`
- Modify: `services/crm-api/src/routes/attachments.ts`

- [ ] **Step 1: Write failing identity and audit tests**

Send two signed requests for the same New API user with changed username, email, and role; assert the stored shadow record refreshes and business-user queries use the new role. Execute a settings update with forwarded IP and User-Agent and assert the audit DTO contains both values.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/request-context.test.ts src/server.test.ts
```

Expected: identity stays stale and audit context is empty.

- [ ] **Step 3: Implement identity refresh and async request context**

Add:

```ts
const storage = new AsyncLocalStorage<CrmRequestContext>();
export function runWithCrmRequestContext<T>(context: CrmRequestContext, work: () => T): T;
export function getCrmRequestContext(): CrmRequestContext | null;
```

Wrap handler routing with the request context. `insertAuditLog` reads the current context and writes `request_ip` and `user_agent`.

Add repository method `updateCrmUserIdentity` and call it when an embedded CRM user already exists. Reuse collision-safe username generation.

Settings updates, offline recharge review, and attachment upload must insert audit records with meaningful before/after snapshots.

- [ ] **Step 4: Run identity and audit tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/request-context.test.ts src/server.test.ts
```

Expected: identity refresh and audit attribution tests pass.

### Task 10: Add Role-Aware CRM Navigation And Reconciliation UI

**Files:**
- Modify: `services/ai-gateway/new-api/web/default/src/components/layout/types.ts`
- Modify: `services/ai-gateway/new-api/web/default/src/components/layout/config/crm.config.ts`
- Modify: `services/ai-gateway/new-api/web/default/src/components/layout/lib/sidebar-view-registry.ts`
- Modify: `services/ai-gateway/new-api/web/default/src/components/layout/lib/sidebar-view-registry.test.ts`
- Modify: `services/ai-gateway/new-api/web/default/src/hooks/use-sidebar-view.ts`
- Modify: `services/ai-gateway/new-api/web/default/src/features/crm/index.tsx`
- Modify: `services/ai-gateway/new-api/web/default/src/features/crm/operations-coverage.test.ts`

- [ ] **Step 1: Write failing navigation and reconciliation tests**

Assert normal role navigation contains only `crm-agent` and super-admin navigation contains only `crm-admin`. Assert the account-event dialog posts `confirm_quota_applied` or `cancel` and does not present an automatic ambiguous quota retry.

- [ ] **Step 2: Run frontend tests and verify RED**

```bash
cd services/ai-gateway/new-api/web/default
bun test src/components/layout/lib/sidebar-view-registry.test.ts src/features/crm/operations-coverage.test.ts
```

Expected: both groups are returned for every role and reconciliation actions use the old payload.

- [ ] **Step 3: Implement role-aware navigation and reconciliation UI**

Pass role through sidebar view resolution:

```ts
getNavGroups: (t, context) => context.role >= ROLE.SUPER_ADMIN
  ? [adminGroup(t)]
  : [agentGroup(t)]
```

Update account-event actions so unresolved `quota_applying`, `local_applying`, and `reconcile_required` rows open a confirmation dialog with explicit `confirm_quota_applied` and `cancel` choices. Update commission labels so `releasable` means available for withdrawal and `released` means already paid.

- [ ] **Step 4: Run frontend checks and verify GREEN**

```bash
bun run typecheck
bun test src/components/layout/lib/sidebar-view-registry.test.ts src/features/crm/operations-coverage.test.ts
```

Expected: typecheck and targeted tests pass.

### Task 11: Expose Scheduler Health

**Files:**
- Create: `services/crm-api/src/scheduler-health.ts`
- Create: `services/crm-api/src/scheduler-health.test.ts`
- Modify: `services/crm-api/src/server.ts`
- Modify: `services/crm-api/src/server.test.ts`

- [ ] **Step 1: Write failing scheduler health tests**

Test a successful run and failed run:

```ts
await scheduler.runNow();
assert.ok(scheduler.snapshot().lastSuccessAt);

await assert.rejects(() => failingScheduler.runNow());
assert.ok(failingScheduler.snapshot().lastFailureAt);
assert.equal(failingScheduler.snapshot().lastErrorCode, "scheduler_run_failed");
```

Assert `/health` includes all three scheduler snapshots.

- [ ] **Step 2: Run scheduler tests and verify RED**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/scheduler-health.test.ts src/server.test.ts
```

Expected: scheduler health module and health payload are missing.

- [ ] **Step 3: Implement scheduler state**

Create a reusable scheduler controller that owns interval setup, overlap prevention, snapshot updates, structured logging, and cleanup. Replace the three duplicated scheduler functions in `server.ts` and include their snapshots in `/health`.

- [ ] **Step 4: Run scheduler tests and verify GREEN**

```bash
pnpm --filter @ai-native/crm-api exec tsx --test src/scheduler-health.test.ts src/server.test.ts
```

Expected: scheduler health tests pass.

### Task 12: Real MySQL Verification And Full Regression

**Files:**
- Create or modify only if needed: `services/crm-api/src/db/mysql.integration.test.ts`
- Modify: `services/crm-api/README.md`
- Modify: `docs/crm-production-runbook.md`

- [ ] **Step 1: Detect an available local MySQL service**

Run:

```bash
mysql --protocol=tcp -h 127.0.0.1 -P 3306 -uroot -e 'SELECT 1'
```

Expected: either a successful query or a documented unavailable-service result.

- [ ] **Step 2: Add and run MySQL integration tests when available**

Integration coverage must run migrations twice, concurrently create withdrawals, concurrently insert ledger rows, and force a transaction rollback. Tests use a dedicated disposable CRM database name and do not alter New API data.

Run:

```bash
CRM_TEST_DATABASE_URL='mysql://root@127.0.0.1:3306/ai_native_crm_test' \
pnpm --filter @ai-native/crm-api exec tsx --test src/db/mysql.integration.test.ts
```

Expected: all integration tests pass. If MySQL is unavailable, retain deterministic unit coverage and report the missing integration evidence.

- [ ] **Step 3: Update operational documentation**

Document:

- New reconciliation actions and operator decision requirements.
- Versioned migration behavior.
- Scheduler health fields and alert recommendations.
- Commission allocation and paid-withdrawal semantics.
- Explicit exclusion of real payment callbacks and automated payouts.

- [ ] **Step 4: Run complete verification**

```bash
pnpm --filter @ai-native/crm-contracts check
pnpm --filter @ai-native/crm-api check
cd services/ai-gateway/new-api/web/default
bun run typecheck
bun test \
  src/features/crm/section.test.ts \
  src/features/crm/column-policy.test.ts \
  src/features/crm/display.test.ts \
  src/features/crm/operations-coverage.test.ts \
  src/features/crm/settings-form.test.ts \
  src/components/layout/lib/crm-shell-visibility.test.ts \
  src/components/layout/lib/sidebar-view-registry.test.ts
cd ../../../../../..
pnpm run verify:workspace
pnpm run check
pnpm run build
git diff --check
```

Expected: every command exits zero and all tests report zero failures.
