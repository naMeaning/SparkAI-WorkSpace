function assertFiniteMoney(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

export function convertRmbToNewApiQuota(amountRmb: number, quotaPerRmb: number): number {
  assertFiniteMoney(amountRmb, "amountRmb");
  if (amountRmb <= 0) {
    throw new Error("amountRmb must be positive");
  }
  if (!Number.isSafeInteger(quotaPerRmb) || quotaPerRmb <= 0) {
    throw new Error("quotaPerRmb must be positive");
  }
  return Math.round(amountRmb * quotaPerRmb);
}

export function convertSignedRmbToNewApiQuota(amountRmb: number, quotaPerRmb: number): number {
  assertFiniteMoney(amountRmb, "amountRmb");
  if (amountRmb === 0) {
    throw new Error("amountRmb must not be zero");
  }
  if (!Number.isSafeInteger(quotaPerRmb) || quotaPerRmb <= 0) {
    throw new Error("quotaPerRmb must be positive");
  }
  return Math.round(amountRmb * quotaPerRmb);
}
