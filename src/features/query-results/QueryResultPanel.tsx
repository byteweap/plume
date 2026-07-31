import { Check, Table2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import type { QueryExecutionResult } from "../query-execution/queryExecution";
import { useI18n } from "../../i18n/I18nContext";
import {
  QueryResultGrid,
  type QueryResultGridEditing,
  type QueryResultSort,
} from "./QueryResultGrid";
import "./QueryResults.css";

export interface QueryResultPanelProps {
  result: QueryExecutionResult;
  sorts?: QueryResultSort[];
  onSortsChange?: (sorts: QueryResultSort[]) => void;
  editing?: QueryResultGridEditing;
}

function getInitialStatementIndex(result: QueryExecutionResult) {
  const rowResultIndex = result.results.findIndex(
    (statement) => statement.kind === "rows",
  );
  return rowResultIndex === -1 ? 0 : rowResultIndex;
}

export function QueryResultPanel({
  result,
  sorts,
  onSortsChange,
  editing,
}: QueryResultPanelProps) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(() =>
    getInitialStatementIndex(result),
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const statement = result.results[activeIndex];

  function selectTabWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + result.results.length) % result.results.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % result.results.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = result.results.length - 1;
    }
    if (nextIndex === undefined) return;

    event.preventDefault();
    setActiveIndex(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  if (!statement) {
    return (
      <section
        className="query-results query-results-empty"
        aria-label={t("query.results.label")}
      >
        <div className="query-result-empty" role="status">
          {t("query.results.noStatements")}
        </div>
      </section>
    );
  }

  const tabId = `query-result-${result.queryId}-${statement.statementIndex}`;
  const statusDetails =
    statement.kind === "rows"
      ? `${statement.retainedRowCount} / ${statement.rowCount} ${t("query.results.rows")}`
      : `${t("query.rowsAffected")} ${statement.affectedRows ?? 0}`;

  return (
    <section className="query-results" aria-label={t("query.results.label")}>
      <header className="query-results-toolbar">
        <div className="query-result-tabs" role="tablist">
          {result.results.map((item, index) => (
            <button
              key={item.statementIndex}
              id={`query-result-tab-${result.queryId}-${item.statementIndex}`}
              className="query-result-tab"
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-controls={`query-result-${result.queryId}-${item.statementIndex}`}
              aria-selected={index === activeIndex}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => selectTabWithKeyboard(event, index)}
            >
              {item.kind === "rows" ? (
                <Table2 size={13} aria-hidden="true" />
              ) : (
                <Check size={13} aria-hidden="true" />
              )}
              <span>
                {t("query.results.statement")} {item.statementIndex + 1}
              </span>
            </button>
          ))}
        </div>
        <div className="query-result-status" role="status">
          <span>{statusDetails}</span>
          {statement.truncated && <strong>{t("query.truncated")}</strong>}
        </div>
      </header>
      <div
        id={tabId}
        className="query-result-content"
        role="tabpanel"
        aria-labelledby={`query-result-tab-${result.queryId}-${statement.statementIndex}`}
      >
        {statement.kind === "rows" ? (
          <QueryResultGrid
            key={statement.statementIndex}
            statement={statement}
            label={`${t("query.results.statement")} ${statement.statementIndex + 1}`}
            emptyLabel={t("query.results.empty")}
            sorts={sorts}
            onSortsChange={onSortsChange}
            editing={editing}
          />
        ) : (
          <div className="query-result-command" role="status">
            <Check size={16} aria-hidden="true" />
            <span>{t("query.results.commandCompleted")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default QueryResultPanel;
