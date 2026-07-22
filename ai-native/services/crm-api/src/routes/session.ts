import {
  crmPageCapabilities,
  crmRolePageGroups,
  type CrmPageCapability,
  type CrmSessionDto
} from "@ai-native/crm-contracts";
import type { CrmRepository, CrmUserContext } from "../types.js";
import { ensureAgent } from "../domain/agents.js";
import { getUser } from "./users.js";

function buildCapabilities(context: CrmUserContext): CrmPageCapability[] {
  if (context.isSuperAdmin) {
    return [crmPageCapabilities.superAdmin];
  }
  return [crmPageCapabilities.agent];
}

export async function getSessionRoute({
  context,
  repository
}: {
  context: CrmUserContext;
  repository: CrmRepository;
}): Promise<CrmSessionDto> {
  const agent = context.isSuperAdmin ? null : await ensureAgent({
    repository,
    crmUserId: context.crmUserId,
    reason: "session default agent"
  });
  const currentUser = await getUser({
    crmUserId: context.crmUserId,
    repository
  });
  const capabilities = buildCapabilities(context);

  return {
    currentUser,
    agent,
    capabilities,
    pageGroups: crmRolePageGroups.filter((item) => capabilities.includes(item.key))
  };
}
