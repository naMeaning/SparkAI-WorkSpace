import {
  agentStatuses,
  withdrawalMethods,
  withdrawalStatuses,
  type CrmAgentDashboardDto,
  type WithdrawalMethod,
  type WithdrawalStatus
} from "@ai-native/crm-contracts";
import { ensureAgent } from "../domain/agents.js";
import { httpError } from "../http.js";
import type { CrmRepository, CrmUserContext } from "../types.js";
import { parsePageOptions } from "./pagination.js";

type AgentDashboardRepository = CrmRepository;

async function sumWithdrawalsByStatuses(
  repository: Pick<CrmRepository, "sumWithdrawals">,
  beneficiaryCrmUserId: number,
  statuses: WithdrawalStatus[]
): Promise<number> {
  const values = await Promise.all(
    statuses.map((status) => repository.sumWithdrawals({ beneficiaryCrmUserId, status }))
  );
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

async function getWithdrawalAmounts(
  repository: Pick<CrmRepository, "sumWithdrawals">,
  beneficiaryCrmUserId: number
): Promise<{ pendingWithdrawalRmb: number; paidWithdrawalRmb: number }> {
  const [pendingWithdrawalRmb, paidWithdrawalRmb] = await Promise.all([
    sumWithdrawalsByStatuses(repository, beneficiaryCrmUserId, [withdrawalStatuses.pending, withdrawalStatuses.approved]),
    repository.sumWithdrawals({ beneficiaryCrmUserId, status: withdrawalStatuses.paid })
  ]);
  return {
    pendingWithdrawalRmb,
    paidWithdrawalRmb
  };
}

function availableCommissionRmb(releasableCommissionRmb: number, pendingWithdrawalRmb: number): number {
  return Math.max(0, Math.round((releasableCommissionRmb - pendingWithdrawalRmb) * 100) / 100);
}

export async function getAgentDashboardRoute({
  context,
  repository
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
}): Promise<CrmAgentDashboardDto> {
  const agent = await ensureAgent({
    repository,
    crmUserId: context.crmUserId,
    reason: "agent dashboard default agent"
  });
  if (agent.status !== agentStatuses.active) {
    throw httpError("agent permission is required", 403, "crm_agent_required");
  }
  const commissionSummary = await repository.getCommissionSummary(context.crmUserId);
  const withdrawalAmounts = await getWithdrawalAmounts(repository, context.crmUserId);
  return {
    agent,
    customerCount: await repository.countAgentCustomers(context.crmUserId),
    subAgentCount: await repository.countSubAgents(context.crmUserId),
    pendingWithdrawalRmb: withdrawalAmounts.pendingWithdrawalRmb,
    paidWithdrawalRmb: withdrawalAmounts.paidWithdrawalRmb,
    availableCommissionRmb: availableCommissionRmb(
      commissionSummary.releasableCommissionRmb,
      withdrawalAmounts.pendingWithdrawalRmb
    ),
    ...commissionSummary
  };
}

export async function listAgentCustomersRoute({
  context,
  repository,
  url
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
  url: URL;
}) {
  await getAgentDashboardRoute({ context, repository });
  const { page, pageSize } = parsePageOptions(url);
  const keyword = url.searchParams.get("keyword") || "";
  const [items, total] = await Promise.all([
    repository.listAgentCustomers(context.crmUserId, { page, pageSize, keyword }),
    repository.countAgentCustomers(context.crmUserId, { keyword })
  ]);
  return { items, total, page, pageSize };
}

export async function listAgentCommissionsRoute({
  context,
  repository,
  url
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
  url: URL;
}) {
  await getAgentDashboardRoute({ context, repository });
  return repository.listCommissions({ ...parsePageOptions(url), beneficiaryCrmUserId: context.crmUserId });
}

export async function listAgentSubAgentsRoute({
  context,
  repository,
  url
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
  url: URL;
}) {
  await getAgentDashboardRoute({ context, repository });
  return repository.listAgents({ ...parsePageOptions(url), parentAgentCrmUserId: context.crmUserId, businessOnly: true });
}

export async function listAgentWithdrawalsRoute({
  context,
  repository,
  url
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
  url: URL;
}) {
  await getAgentDashboardRoute({ context, repository });
  return repository.listWithdrawals({ ...parsePageOptions(url), beneficiaryCrmUserId: context.crmUserId });
}

function requirePositiveAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError("amountRmb must be positive", 400, "invalid_request");
  }
  return Math.round(amount * 100) / 100;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`${name} is required`, 400, "invalid_request");
  }
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireWithdrawalMethod(value: unknown): WithdrawalMethod {
  if (!Object.values(withdrawalMethods).includes(value as WithdrawalMethod)) {
    throw httpError("withdrawal payout method is invalid", 400, "invalid_request");
  }
  return value as WithdrawalMethod;
}

export async function createAgentWithdrawalRoute({
  context,
  repository,
  body
}: {
  context: CrmUserContext;
  repository: AgentDashboardRepository;
  body: Record<string, unknown>;
}) {
  await getAgentDashboardRoute({ context, repository });
  const amount = requirePositiveAmount(body.amountRmb);
  const payoutMethod = requireWithdrawalMethod(body.payoutMethod);
  const payoutAccountName = requireText(body.payoutAccountName, "payoutAccountName");
  const payoutAccount = requireText(body.payoutAccount, "payoutAccount");
  const payoutBankName = optionalText(body.payoutBankName);
  if (payoutMethod === withdrawalMethods.bank && !payoutBankName) {
    throw httpError("payoutBankName is required", 400, "invalid_request");
  }
  return repository.createWithdrawalWithBalanceCheck({
    beneficiaryCrmUserId: context.crmUserId,
    amountRmb: amount,
    payoutMethod,
    payoutAccountName,
    payoutAccount,
    payoutBankName
  });
}
