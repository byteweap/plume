import type { ConnectionProfile, SqlRiskPolicy } from "../connections/connection";
import type { SqlRisk } from "./sqlRiskAnalysis";

export function effectiveSqlRiskPolicy(
  profile: Pick<ConnectionProfile, "environment" | "sqlRiskPolicy">,
): SqlRiskPolicy {
  const policy = profile.sqlRiskPolicy ?? "all";
  return profile.environment === "production" && policy === "off"
    ? "critical-only"
    : policy;
}

export function filterSqlRisksForProfile(
  risks: readonly SqlRisk[],
  profile: Pick<ConnectionProfile, "environment" | "sqlRiskPolicy">,
): SqlRisk[] {
  const policy = effectiveSqlRiskPolicy(profile);
  if (policy === "off") return [];
  if (policy === "critical-only") {
    return risks.filter((risk) => risk.severity === "critical");
  }
  return [...risks];
}
