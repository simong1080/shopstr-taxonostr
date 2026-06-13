import {
  proofAmountToNumber,
  sumProofAmounts,
} from "@/utils/cashu/proof-amount";

describe("proof amount helpers", () => {
  it("normalizes supported proof amount shapes", () => {
    expect(proofAmountToNumber(21)).toBe(21);
    expect(proofAmountToNumber("34")).toBe(34);
    expect(proofAmountToNumber(55n)).toBe(55);
    expect(proofAmountToNumber({ toNumber: () => 89 })).toBe(89);
  });

  it("returns zero for invalid proof amount shapes", () => {
    expect(proofAmountToNumber(Number.NaN)).toBe(0);
    expect(proofAmountToNumber("not-a-number")).toBe(0);
    expect(proofAmountToNumber(null)).toBe(0);
    expect(proofAmountToNumber(undefined)).toBe(0);
    expect(
      proofAmountToNumber({ toNumber: () => Number.POSITIVE_INFINITY })
    ).toBe(0);
    expect(proofAmountToNumber({ toNumber: () => "12" })).toBe(0);
    expect(
      proofAmountToNumber({
        toNumber: () => {
          throw new Error("bad amount");
        },
      })
    ).toBe(0);
  });

  it("sums proofs with mixed amount shapes", () => {
    expect(
      sumProofAmounts([
        { amount: 1 },
        { amount: "2" },
        { amount: 3n },
        { amount: { toNumber: () => 4 } },
        { amount: "bad" },
        {},
      ])
    ).toBe(10);
  });
});
