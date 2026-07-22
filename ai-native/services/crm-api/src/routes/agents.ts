import type { IncomingMessage } from "node:http";
import { agentCategories, agentRelationshipBindSources, agentStatuses, type AgentCategory, type AgentStatus } from "@ai-native/crm-contracts";
import { bindCustomerAgent, createAgent, type AgentRepository } from "../domain/agents.js";
import { httpError, parsePositiveInteger, readJsonBody } from "../http.js";
import type { CrmRepository } from "../types.js";
import { parsePageOptions } from "./pagination.js";

export async function listAgentsRoute({ repository, url }: { repository: Pick<CrmRepository, "listAgents">; url: URL }) {
  return repository.listAgents({ ...parsePageOptions(url), businessOnly: true });
}

function parseOptionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parsePositiveInteger(value, name);
}

function parseOptionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw httpError(`${name} must be a string`, 400, "invalid_request");
  }
  return value;
}

function parseOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw httpError(`${name} must be a boolean`, 400, "invalid_request");
  }
  return value;
}

function parseOptionalAgentCategory(value: unknown): AgentCategory | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!Object.values(agentCategories).includes(value as AgentCategory)) {
    throw httpError("category is invalid", 400, "invalid_request");
  }
  return value as AgentCategory;
}

function parseOptionalAgentStatus(value: unknown): AgentStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!Object.values(agentStatuses).includes(value as AgentStatus)) {
    throw httpError("status is invalid", 400, "invalid_request");
  }
  return value as AgentStatus;
}

export async function createAgentRoute({
  req,
  repository,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: AgentRepository;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  return createAgent({
    repository,
    input: {
      ...body,
      crmUserId: parsePositiveInteger(body.crmUserId, "crmUserId"),
      category: parseOptionalAgentCategory(body.category),
      status: parseOptionalAgentStatus(body.status),
      operatorCrmUserId
    }
  });
}

export async function updateAgentRoute({
  req,
  params,
  repository,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  params: Record<string, string>;
  repository: AgentRepository;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const agentId = parsePositiveInteger(params.agentId, "agentId");
  const existing = await repository.getAgentById(agentId);
  if (!existing) {
    throw httpError("agent not found", 404, "agent_not_found");
  }
  const parent = body.parentAgentCrmUserId === undefined
    ? existing.parentAgentCrmUserId
    : parseOptionalPositiveInteger(body.parentAgentCrmUserId, "parentAgentCrmUserId") || null;
  return createAgent({
    repository,
    input: {
      crmUserId: existing.crmUserId,
      category: parseOptionalAgentCategory(body.category) || existing.category,
      status: parseOptionalAgentStatus(body.status) || existing.status,
      parentAgentCrmUserId: parent,
      operatorCrmUserId,
      reason: parseOptionalText(body.reason, "reason") || "admin agent update"
    }
  });
}

export async function bindCustomerAgentRoute({
  req,
  repository,
  operatorCrmUserId
}: {
  req: IncomingMessage;
  repository: AgentRepository;
  operatorCrmUserId: number;
}) {
  const body = await readJsonBody(req);
  const customerCrmUserId = parsePositiveInteger(body.customerCrmUserId, "customerCrmUserId");
  const existingRelationship = await repository.getAgentRelationshipByCustomer(customerCrmUserId);
  return bindCustomerAgent({
    repository,
    input: {
      agentCrmUserId: parseOptionalPositiveInteger(body.agentCrmUserId, "agentCrmUserId"),
      inviteCode: parseOptionalText(body.inviteCode, "inviteCode"),
      allowRebind: parseOptionalBoolean(body.allowRebind, "allowRebind"),
      reason: parseOptionalText(body.reason, "reason"),
      bindSource: existingRelationship ? agentRelationshipBindSources.adminRebind : agentRelationshipBindSources.adminBind,
      customerCrmUserId,
      operatorCrmUserId
    }
  });
}
