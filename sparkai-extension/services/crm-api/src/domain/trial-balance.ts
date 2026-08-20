import {
  accountEventTypes,
  signupTrialGrantRmb
} from "@ai-native/crm-contracts";
import type { CrmRepository, NewApiClient } from "../types.js";
import { createAccountEvent } from "./account-events.js";

export function signupTrialGrantIdempotencyKey(crmUserId: number): string {
  return `signup-trial:${crmUserId}`;
}

export async function grantSignupTrialBalance({
  repository,
  newApiClient,
  crmUserId,
  newApiUserId,
  quotaPerRmb,
  operatorCrmUserId
}: {
  repository: CrmRepository;
  newApiClient: Pick<NewApiClient, "manageUserQuota">;
  crmUserId: number;
  newApiUserId: number;
  quotaPerRmb: number;
  operatorCrmUserId: number;
}) {
  await createAccountEvent({
    repository,
    newApiClient,
    config: { quotaPerRmb },
    input: {
      eventType: accountEventTypes.signupTrialGrant,
      crmUserId,
      operatorCrmUserId,
      amountRmb: signupTrialGrantRmb,
      idempotencyKey: signupTrialGrantIdempotencyKey(crmUserId),
      reason: "new user trial balance granted by CRM",
      metadata: { newApiUserId }
    }
  });
}
