import { describe, expect, it } from "vitest";
import { analyzeSqlRisks } from "./sqlRiskAnalysis";
import { effectiveSqlRiskPolicy, filterSqlRisksForProfile } from "./sqlRiskPolicy";

const risks = analyzeSqlRisks(
  "DROP TABLE public.logs; DELETE FROM public.sessions;",
);

describe("SQL risk policy", () => {
  it("defaults missing policy data to all detected risks", () => {
    expect(
      filterSqlRisksForProfile(risks, { environment: "development" }),
    ).toEqual(risks);
  });

  it("supports reduced and disabled prompts outside production", () => {
    expect(
      filterSqlRisksForProfile(risks, {
        environment: "staging",
        sqlRiskPolicy: "critical-only",
      }).map((risk) => risk.type),
    ).toEqual(["drop"]);
    expect(
      filterSqlRisksForProfile(risks, {
        environment: "test",
        sqlRiskPolicy: "off",
      }),
    ).toEqual([]);
  });

  it("fails safe when production data unexpectedly requests no prompts", () => {
    const profile = { environment: "production" as const, sqlRiskPolicy: "off" as const };
    expect(effectiveSqlRiskPolicy(profile)).toBe("critical-only");
    expect(filterSqlRisksForProfile(risks, profile).map((risk) => risk.type)).toEqual([
      "drop",
    ]);
  });
});
