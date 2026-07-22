import type {
  AgentDto,
  AgentRelationshipDto,
  CrmRepository,
  CrmUserDto,
  CrmUserProfileDto,
  ListUsersResult,
  CrmUserRecord
} from "../types.js";
import { ensureAgent } from "../domain/agents.js";
import { httpError, parseListLimit, parsePositiveInteger } from "../http.js";

export function combineUserRecord(
  profile: CrmUserProfileDto,
  crm: {
    agentRelationship?: AgentRelationshipDto | null;
    agent: AgentDto | null;
    crmUser?: CrmUserRecord | null;
  }
): CrmUserDto {
  const crmUserId = crm.crmUser?.id ?? profile.crmUserId;
  return {
    crmUserId,
    username: crm.crmUser?.username || "",
    displayName: crm.crmUser?.username || "",
    email: crm.crmUser?.email || "",
    newApiRole: crm.crmUser?.newApiRole ?? 1,
    firstTopupDiscountRate: crm.crmUser?.firstTopupDiscountRate ?? null,
    firstTopupDiscountAvailable: Boolean(crm.crmUser?.firstTopupDiscountRate && !crm.crmUser?.firstTopupDiscountUsedAt),
    signupTrialGrantStatus: crm.crmUser?.signupTrialGrantStatus || "granted",
    createdAt: crm.crmUser?.createdAt ?? null,
    phone: profile.phone || "",
    wechat: profile.wechat || "",
    remark: profile.remark || "",
    cumulativePaidRmb: Number(profile.cumulativePaidRmb || 0),
    isEnterprise: Boolean(profile.isEnterprise),
    enterprisePriceRmb: profile.enterprisePriceRmb ?? null,
    enterpriseFixedCommissionPerImage: profile.enterpriseFixedCommissionPerImage ?? null,
    isRisk: Boolean(profile.isRisk),
    agentRelationship: crm.agentRelationship || null,
    agent: crm.agent
  };
}

function emptyProfile(crmUserId: number): CrmUserProfileDto {
  return {
    crmUserId,
    phone: "",
    wechat: "",
    remark: "",
    cumulativePaidRmb: 0,
    isEnterprise: false,
    enterprisePriceRmb: null,
    enterpriseFixedCommissionPerImage: null,
    isRisk: false,
  };
}

export async function listUsers({
  url,
  repository
}: {
  url: URL;
  repository: CrmRepository;
}): Promise<ListUsersResult> {
  const page = parsePositiveInteger(url.searchParams.get("page") || url.searchParams.get("p") || 1, "page");
  const pageSize = parseListLimit(url.searchParams.get("pageSize") || url.searchParams.get("page_size"), 20, 100);
  const keyword = url.searchParams.get("keyword") || "";
  const hasAgentRelationship = url.searchParams.get("hasAgentRelationship") === "true";
  const enterpriseOnly = url.searchParams.get("enterpriseOnly") === "true";
  const pageData = await repository.listCrmUsers({
    page,
    pageSize,
    keyword,
    excludeSuperAdmins: true,
    hasAgentRelationship,
    enterpriseOnly
  });
  const items = pageData.items;
  const users = [];

  for (const crmUser of items) {
    const profile = await repository.getUserProfile(crmUser.id);
    const agentRelationship = await repository.getAgentRelationshipByCustomer(crmUser.id);
    const agent = await ensureAgent({
      repository,
      crmUserId: crmUser.id,
      reason: "admin user list default agent"
    });
    users.push(combineUserRecord(profile, {
      agentRelationship,
      agent,
      crmUser
    }));
  }

  return {
    items: users,
    total: pageData.total || users.length,
    page,
    pageSize
  };
}

export async function getUser({
  crmUserId,
  repository
}: {
  crmUserId: number;
  repository: CrmRepository;
}): Promise<CrmUserDto> {
  const crmUser = await repository.getCrmUserById(crmUserId);
  if (!crmUser) {
    throw httpError("CRM user was not found", 404, "crm_user_not_found");
  }
  const isSuperAdmin = crmUser.newApiRole >= 100;
  const profile = isSuperAdmin ? emptyProfile(crmUser.id) : await repository.getUserProfile(crmUser.id);
  const agentRelationship = isSuperAdmin ? null : await repository.getAgentRelationshipByCustomer(crmUser.id);
  const agent = isSuperAdmin ? null : await ensureAgent({
    repository,
    crmUserId: crmUser.id,
    reason: "user detail default agent"
  });
  return combineUserRecord(profile, {
    agentRelationship,
    agent,
    crmUser
  });
}

export async function updateUserProfile({
  crmUserId,
  patch,
  operatorCrmUserId,
  repository
}: {
  crmUserId: number;
  patch: Partial<CrmUserProfileDto>;
  operatorCrmUserId: number;
  repository: Pick<CrmRepository, "getUserProfile" | "saveUserProfile" | "insertAuditLog">;
}): Promise<CrmUserProfileDto> {
  const before = await repository.getUserProfile(crmUserId);
  const next: CrmUserProfileDto = {
    ...before,
    phone: typeof patch.phone === "string" ? patch.phone : before.phone,
    wechat: typeof patch.wechat === "string" ? patch.wechat : before.wechat,
    remark: typeof patch.remark === "string" ? patch.remark : before.remark,
    cumulativePaidRmb: patch.cumulativePaidRmb === undefined ? before.cumulativePaidRmb : Number(patch.cumulativePaidRmb),
    isEnterprise: patch.isEnterprise === undefined ? before.isEnterprise : Boolean(patch.isEnterprise),
    enterprisePriceRmb: patch.enterprisePriceRmb === undefined ? before.enterprisePriceRmb : patch.enterprisePriceRmb,
    enterpriseFixedCommissionPerImage: patch.enterpriseFixedCommissionPerImage === undefined
      ? before.enterpriseFixedCommissionPerImage
      : patch.enterpriseFixedCommissionPerImage,
    isRisk: patch.isRisk === undefined ? before.isRisk : Boolean(patch.isRisk)
  };
  const saved = await repository.saveUserProfile(next);
  await repository.insertAuditLog({
    operatorCrmUserId,
    targetType: "user_profile",
    targetId: crmUserId,
    action: "user_profile.update",
    reason: "admin profile update",
    before,
    after: saved
  });
  return saved;
}
