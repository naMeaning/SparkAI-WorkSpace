import {
  agentCategories,
  agentLevels,
  agentRelationshipBindSources,
  agentRelationshipStatuses,
  agentStatuses,
  type AgentDto,
  type AgentCategory,
  type AgentRelationshipBindSource,
  type AgentRelationshipDto,
  type AgentStatus,
  type CrmUserProfileDto
} from "@ai-native/crm-contracts";
import { randomBytes } from "node:crypto";
import type { AgentCreateInput, AgentRelationshipInput, AuditLogEntryCreate } from "../types.js";
import { httpError } from "../http.js";

export interface AgentRepository {
  getCrmUserById(crmUserId: number): Promise<unknown | null>;
  getAgentById(agentId: number): Promise<AgentDto | null>;
  getAgentByCrmUserId(crmUserId: number): Promise<AgentDto | null>;
  getAgentByInviteCode(inviteCode: string): Promise<AgentDto | null>;
  saveAgent(input: Omit<AgentDto, "id" | "createdAt" | "updatedAt"> & { id?: number }): Promise<AgentDto>;
  getUserProfile(crmUserId: number): Promise<CrmUserProfileDto>;
  getAgentRelationshipByCustomer(crmUserId: number): Promise<AgentRelationshipDto | null>;
  saveAgentRelationship(customerCrmUserId: number, relationship: AgentRelationshipDto): Promise<AgentRelationshipDto>;
  insertAuditLog(entry: AuditLogEntryCreate): Promise<unknown>;
}

function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw httpError(`${name} must be a positive integer`, 400, "invalid_request");
  }
  return value;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw httpError(`${name} is required`, 400, "invalid_request");
  }
  return value.trim();
}

function optionalAgentCategory(value: unknown): AgentCategory {
  if (value === undefined || value === null || value === "") return agentCategories.normal;
  if (!Object.values(agentCategories).includes(value as AgentCategory)) {
    throw httpError("agent category is invalid", 400, "invalid_request");
  }
  return value as AgentCategory;
}

function optionalAgentStatus(value: unknown): AgentStatus {
  if (value === undefined || value === null || value === "") return agentStatuses.active;
  if (!Object.values(agentStatuses).includes(value as AgentStatus)) {
    throw httpError("agent status is invalid", 400, "invalid_request");
  }
  return value as AgentStatus;
}

function didStorageMutate(record: unknown): boolean {
  return (record as { didMutate?: boolean }).didMutate !== false;
}

const inviteCodeLength = 8;
const inviteCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const maxInviteCodeRetries = 10;

function randomInviteCodeSegment(): string {
  return [...randomBytes(inviteCodeLength)]
    .map((byte) => inviteCodeAlphabet[byte % inviteCodeAlphabet.length])
    .join("");
}

export function buildRandomInviteCode(randomSegment: () => string = randomInviteCodeSegment): string {
  const segment = randomSegment().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, inviteCodeLength);
  if (segment.length !== inviteCodeLength) {
    throw new Error("invite code random segment must contain at least 8 alphanumeric characters");
  }
  return segment;
}

export async function buildUniqueInviteCode(
  repository: Pick<AgentRepository, "getAgentByInviteCode">,
  randomSegment?: () => string
): Promise<string> {
  for (let attempt = 0; attempt < maxInviteCodeRetries; attempt += 1) {
    const inviteCode = buildRandomInviteCode(randomSegment);
    const existing = await repository.getAgentByInviteCode(inviteCode);
    if (!existing) return inviteCode;
  }
  throw httpError("invite code is already used by another agent", 409, "invite_code_conflict");
}

async function resolveParentAgent(repository: AgentRepository, crmUserId: number, parentAgentCrmUserId?: number | null): Promise<AgentDto | null> {
  if (!parentAgentCrmUserId) return null;
  const parent = await repository.getAgentByCrmUserId(parentAgentCrmUserId);
  if (!parent || parent.status !== agentStatuses.active) {
    throw httpError("parent agent must be active", 400, "invalid_request");
  }
  if (parent.crmUserId === crmUserId) {
    throw httpError("agent cannot be its own parent", 400, "invalid_request");
  }
  return parent;
}

function isSameAgent(existing: AgentDto, nextParent: AgentDto | null, category: AgentCategory, status: AgentStatus): boolean {
  return (
    existing.status === status &&
    existing.category === category &&
    (existing.parentAgentCrmUserId || null) === (nextParent?.crmUserId || null)
  );
}

export async function createAgent({
  repository,
  input
}: {
  repository: AgentRepository;
  input: Partial<AgentCreateInput>;
}): Promise<AgentDto> {
  const crmUserId = requirePositiveInteger(input.crmUserId, "crmUserId");
  const operatorCrmUserId = requirePositiveInteger(input.operatorCrmUserId, "operatorCrmUserId");
  const reason = requireText(input.reason, "reason");
  const crmUser = await repository.getCrmUserById(crmUserId);
  if (!crmUser) {
    throw httpError("CRM user was not found", 404, "crm_user_not_found");
  }
  const existing = await repository.getAgentByCrmUserId(crmUserId);
  const parent = await resolveParentAgent(repository, crmUserId, input.parentAgentCrmUserId);
  const category = input.category === undefined ? existing?.category || agentCategories.normal : optionalAgentCategory(input.category);
  const status = input.status === undefined ? existing?.status || agentStatuses.active : optionalAgentStatus(input.status);

  if (existing && isSameAgent(existing, parent, category, status)) {
    return existing;
  }

  const inviteCode = existing?.inviteCode || await buildUniqueInviteCode(repository);
  const existingCodeOwner = await repository.getAgentByInviteCode(inviteCode);
  if (existingCodeOwner && existingCodeOwner.crmUserId !== crmUserId) {
    throw httpError("invite code is already used by another agent", 409, "invite_code_conflict");
  }

  const saved = await repository.saveAgent({
    id: existing?.id,
    crmUserId,
    status,
    category,
    inviteCode,
    parentAgentId: parent?.id || null,
    parentAgentCrmUserId: parent?.crmUserId || null,
    level: existing?.level || agentLevels.standard,
    effectivePaidCustomerCount: existing?.effectivePaidCustomerCount || 0,
    levelEffectiveAt: existing?.levelEffectiveAt || null,
    levelExpiresAt: existing?.levelExpiresAt || null,
    lastLevelEvaluatedAt: existing?.lastLevelEvaluatedAt || null
  });

  if (didStorageMutate(saved)) {
    await repository.insertAuditLog({
      operatorCrmUserId,
      targetType: "agent",
      targetId: crmUserId,
      action: existing ? "agent.update" : "agent.create",
      reason,
      before: existing,
      after: saved
    });
  }

  return saved;
}

export async function ensureAgent({
  repository,
  crmUserId,
  operatorCrmUserId,
  reason = "auto-create default agent"
}: {
  repository: AgentRepository;
  crmUserId: number;
  operatorCrmUserId?: number;
  reason?: string;
}): Promise<AgentDto> {
  const existing = await repository.getAgentByCrmUserId(crmUserId);
  if (existing) return existing;
  return createAgent({
    repository,
    input: {
      crmUserId,
      category: agentCategories.normal,
      operatorCrmUserId: operatorCrmUserId || crmUserId,
      reason
    }
  });
}

async function resolveAgentForBinding(repository: AgentRepository, input: Pick<AgentRelationshipInput, "agentCrmUserId" | "inviteCode">): Promise<AgentDto> {
  const agent = input.inviteCode
    ? await repository.getAgentByInviteCode(input.inviteCode)
    : input.agentCrmUserId
      ? await repository.getAgentByCrmUserId(input.agentCrmUserId)
      : null;

  if (!agent || agent.status !== agentStatuses.active) {
    throw httpError("active agent not found", 400, "invalid_request");
  }
  return agent;
}

function requireBindSource(value: unknown): AgentRelationshipBindSource {
  if (!Object.values(agentRelationshipBindSources).includes(value as AgentRelationshipBindSource)) {
    throw httpError("bindSource is invalid", 400, "invalid_request");
  }
  return value as AgentRelationshipBindSource;
}

function isSameRelationship(existing: AgentRelationshipDto, agent: AgentDto, bindSource: AgentRelationshipBindSource): boolean {
  return (
    existing.agentCrmUserId === agent.crmUserId &&
    existing.bindSource === bindSource &&
    existing.status === agentRelationshipStatuses.active
  );
}

async function rejectPaidCustomerBind(repository: AgentRepository, crmUserId: number): Promise<void> {
  const profile = await repository.getUserProfile(crmUserId);
  if (Number(profile.cumulativePaidRmb || 0) > 0) {
    throw httpError("cannot bind customer relationship after first paid topup without rebind approval", 400, "invalid_request");
  }
}

export async function bindCustomerAgent({
  repository,
  input
}: {
  repository: AgentRepository;
  input: Partial<AgentRelationshipInput> & { bindSource?: AgentRelationshipBindSource };
}): Promise<AgentRelationshipDto> {
  const customerCrmUserId = requirePositiveInteger(input.customerCrmUserId, "customerCrmUserId");
  const operatorCrmUserId = requirePositiveInteger(input.operatorCrmUserId, "operatorCrmUserId");
  const bindSource = requireBindSource(input.bindSource || agentRelationshipBindSources.adminBind);
  const reason = requireText(input.reason, "reason");
  const customer = await repository.getCrmUserById(customerCrmUserId);
  if (!customer) {
    throw httpError("CRM user was not found", 404, "crm_user_not_found");
  }

  const agent = await resolveAgentForBinding(repository, input);
  if (agent.crmUserId === customerCrmUserId) {
    throw httpError("agent cannot bind itself as a customer", 400, "invalid_request");
  }

  const existing = await repository.getAgentRelationshipByCustomer(customerCrmUserId);
  if (existing && isSameRelationship(existing, agent, bindSource)) {
    return existing;
  }

  const allowRebind = Boolean(input.allowRebind);
  if (existing && !allowRebind) {
    throw httpError("customer already has an active agent relationship", 409, "agent_relationship_conflict");
  }
  if (!allowRebind) {
    await rejectPaidCustomerBind(repository, customerCrmUserId);
  }

  const relationship: AgentRelationshipDto = {
    id: existing?.id,
    customerCrmUserId,
    agentCrmUserId: agent.crmUserId,
    bindSource,
    status: agentRelationshipStatuses.active,
    bindReason: reason
  };
  const saved = await repository.saveAgentRelationship(customerCrmUserId, relationship);

  if (didStorageMutate(saved)) {
    await repository.insertAuditLog({
      operatorCrmUserId,
      targetType: "agent_relationship",
      targetId: customerCrmUserId,
      action: existing ? "agent_relationship.rebind" : "agent_relationship.bind",
      reason,
      before: existing,
      after: saved
    });
  }

  return saved;
}
