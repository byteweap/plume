import { AlertTriangle, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConnectionProfile } from "../connections/connection";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import type { SqlRisk } from "./sqlRiskAnalysis";
import "./SqlRiskConfirmationDialog.css";

export interface SqlRiskExecutionContext {
  profile: ConnectionProfile;
  database: string;
  schema: string;
}

export function SqlRiskConfirmationDialog({
  context,
  risks,
  onCancel,
  onConfirm,
}: {
  context: SqlRiskExecutionContext;
  risks: readonly SqlRisk[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [databaseConfirmation, setDatabaseConfirmation] = useState("");
  const requiredDatabase =
    context.profile.environment === "production" &&
    risks.some((risk) => risk.severity === "critical")
      ? context.database
      : undefined;
  const canConfirm =
    requiredDatabase === undefined || databaseConfirmation === requiredDatabase;

  useEffect(() => {
    cancelRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="sql-risk-backdrop" role="presentation">
      <section
        className="sql-risk-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sql-risk-title"
        aria-describedby="sql-risk-description"
      >
        <header>
          <AlertTriangle size={19} aria-hidden="true" />
          <div>
            <h2 id="sql-risk-title">{t("safety.confirm.title")}</h2>
            <p id="sql-risk-description">{t("safety.confirm.body")}</p>
          </div>
          <IconButton label={t("safety.confirm.close")} onClick={onCancel}>
            <X size={15} />
          </IconButton>
        </header>

        <div className="sql-risk-body">
          <dl className="sql-risk-context">
            <div>
              <dt>{t("safety.confirm.connection")}</dt>
              <dd>{context.profile.name}</dd>
            </div>
            <div>
              <dt>{t("safety.confirm.host")}</dt>
              <dd>
                {context.profile.host}:{context.profile.port}
              </dd>
            </div>
            <div>
              <dt>{t("safety.confirm.database")}</dt>
              <dd>{context.database}</dd>
            </div>
            <div>
              <dt>{t("safety.confirm.schema")}</dt>
              <dd>{context.schema}</dd>
            </div>
            <div>
              <dt>{t("safety.confirm.environment")}</dt>
              <dd className={`sql-risk-environment sql-risk-environment-${context.profile.environment}`}>
                <span aria-hidden="true" />
                {t(`environment.${context.profile.environment}`)}
              </dd>
            </div>
          </dl>

          <section className="sql-risk-findings" aria-labelledby="sql-risk-findings-title">
            <h3 id="sql-risk-findings-title">{t("safety.confirm.risks")}</h3>
            <ol>
              {risks.map((risk) => (
                <li key={`${risk.type}-${risk.operationFrom}`}>
                  <div className="sql-risk-finding-heading">
                    <strong>{t(`safety.risk.${risk.type}`)}</strong>
                    <span className={`sql-risk-severity sql-risk-severity-${risk.severity}`}>
                      {t(`safety.severity.${risk.severity}`)}
                    </span>
                  </div>
                  <div className="sql-risk-target">
                    <span>{t("safety.confirm.target")}</span>
                    <code>
                      {risk.targets.length > 0
                        ? risk.targets.join(", ")
                        : t("safety.confirm.unknownTarget")}
                    </code>
                  </div>
                  <pre>{risk.statementSummary}</pre>
                </li>
              ))}
            </ol>
          </section>

          {requiredDatabase && (
            <div className="sql-risk-production-confirmation">
              <div>
                <strong>{t("safety.confirm.productionTitle")}</strong>
                <span>{t("safety.confirm.productionBody")}</span>
              </div>
              <code>{requiredDatabase}</code>
              <label>
                <span>{t("safety.confirm.databaseInput")}</span>
                <input
                  value={databaseConfirmation}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setDatabaseConfirmation(event.currentTarget.value)
                  }
                />
              </label>
            </div>
          )}
        </div>

        <footer>
          <button
            ref={cancelRef}
            className="button button-secondary button-compact"
            type="button"
            onClick={onCancel}
          >
            {t("safety.confirm.cancel")}
          </button>
          <button
            className="button button-compact sql-risk-confirm"
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            <Play size={13} fill="currentColor" />
            {t("safety.confirm.execute")}
          </button>
        </footer>
      </section>
    </div>
  );
}
