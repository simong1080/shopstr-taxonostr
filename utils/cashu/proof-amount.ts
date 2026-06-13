export function proofAmountToNumber(amount: unknown): number {
  if (typeof amount === "number") return Number.isFinite(amount) ? amount : 0;
  if (typeof amount === "string") {
    const parsed = Number(amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof amount === "bigint") {
    const parsed = Number(amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (
    amount &&
    typeof amount === "object" &&
    "toNumber" in amount &&
    typeof amount.toNumber === "function"
  ) {
    try {
      const parsed = (amount as { toNumber: () => unknown }).toNumber();
      return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

export function sumProofAmounts(
  proofs: Array<{ amount?: unknown }> | null | undefined
): number {
  return (proofs || []).reduce(
    (acc, proof) => acc + proofAmountToNumber(proof.amount),
    0
  );
}
