import type { CrmRepository } from "../types.js";

export async function getDashboardSummary({
  repository
}: {
  repository: CrmRepository;
}) {
  return repository.getDashboardSummary();
}
