import {
  AlertCircle,
  CheckCircle2,
  FileDown,
  LoaderCircle,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import {
  getCsvExportData,
  type CsvDelimiter,
  type CsvEncoding,
  type CsvExportProgress,
} from "./csvExport";
import { csvExportApi } from "./csvExportApi";
import type { GridSelection } from "./queryResultRows";
import "./CsvExportDialog.css";

type ExportScope = "all" | "selection";
type ExportStatus =
  | "idle"
  | "choosing"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export interface CsvExportDialogProps {
  statement: QueryStatementResult;
  selection?: GridSelection;
  onClose: () => void;
}

export function CsvExportDialog({
  statement,
  selection,
  onClose,
}: CsvExportDialogProps) {
  const { locale, t } = useI18n();
  const allData = useMemo(() => getCsvExportData(statement), [statement]);
  const selectedData = useMemo(
    () => getCsvExportData(statement, selection),
    [selection, statement],
  );
  const [scope, setScope] = useState<ExportScope>("all");
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>("comma");
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8-bom");
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState<CsvExportProgress>({
    taskId: "",
    completedRows: 0,
    totalRows: 0,
  });
  const activeTaskId = useRef<string | undefined>(undefined);
  const dialogRef = useRef<HTMLElement>(null);
  const data = scope === "selection" ? selectedData : allData;
  const busy = ["choosing", "running", "cancelling"].includes(status);
  const progressLabel = t("query.export.progress")
    .replace("{completed}", progress.completedRows.toLocaleString(locale))
    .replace("{total}", progress.totalRows.toLocaleString(locale));

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function startExport() {
    if (!data || busy) return;

    const taskId = crypto.randomUUID();
    activeTaskId.current = taskId;
    setProgress({ taskId, completedRows: 0, totalRows: data.rows.length });
    setStatus("choosing");
    try {
      const result = await csvExportApi.execute(
        {
          taskId,
          suggestedFileName: `query-result-${statement.statementIndex + 1}.csv`,
          columns: data.columns,
          rows: data.rows,
          includeHeaders,
          delimiter,
          encoding,
        },
        (nextProgress) => {
          setProgress(nextProgress);
          setStatus((current) =>
            current === "cancelling" ? current : "running",
          );
        },
      );
      setProgress((current) => ({
        ...current,
        completedRows: result.rowsWritten,
      }));
      setStatus(
        result.status === "completed"
          ? "completed"
          : result.status === "cancelled"
            ? "cancelled"
            : "idle",
      );
    } catch {
      setStatus("failed");
    } finally {
      activeTaskId.current = undefined;
    }
  }

  async function cancelExport() {
    const taskId = activeTaskId.current;
    if (!taskId || status !== "running") return;

    setStatus("cancelling");
    try {
      await csvExportApi.cancel(taskId);
    } catch {
      setStatus("failed");
    }
  }

  function closeIfIdle() {
    if (!busy) onClose();
  }

  return (
    <div
      className="csv-export-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeIfIdle();
      }}
    >
      <section
        ref={dialogRef}
        className="csv-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-export-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeIfIdle();
        }}
      >
        <header className="csv-export-header">
          <div>
            <FileDown size={17} aria-hidden="true" />
            <h2 id="csv-export-title">{t("query.export.title")}</h2>
          </div>
          <IconButton
            label={t("query.export.close")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="csv-export-body">
          <fieldset disabled={busy}>
            <legend>{t("query.export.scope")}</legend>
            <div className="csv-export-segmented">
              <label>
                <input
                  type="radio"
                  name="csv-export-scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                <span>{t("query.export.scopeAll")}</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="csv-export-scope"
                  value="selection"
                  checked={scope === "selection"}
                  disabled={!selectedData}
                  onChange={() => setScope("selection")}
                />
                <span>{t("query.export.scopeSelection")}</span>
              </label>
            </div>
          </fieldset>

          <div className="csv-export-options">
            <label>
              <span>{t("query.export.delimiter")}</span>
              <select
                value={delimiter}
                disabled={busy}
                onChange={(event) =>
                  setDelimiter(event.currentTarget.value as CsvDelimiter)
                }
              >
                <option value="comma">{t("query.export.delimiterComma")}</option>
                <option value="semicolon">
                  {t("query.export.delimiterSemicolon")}
                </option>
                <option value="tab">{t("query.export.delimiterTab")}</option>
              </select>
            </label>
            <label>
              <span>{t("query.export.encoding")}</span>
              <select
                value={encoding}
                disabled={busy}
                onChange={(event) =>
                  setEncoding(event.currentTarget.value as CsvEncoding)
                }
              >
                <option value="utf-8">UTF-8</option>
                <option value="utf-8-bom">UTF-8 BOM</option>
                <option value="utf-16le">UTF-16 LE</option>
              </select>
            </label>
          </div>

          <label className="csv-export-checkbox">
            <input
              type="checkbox"
              checked={includeHeaders}
              disabled={busy}
              onChange={(event) => setIncludeHeaders(event.currentTarget.checked)}
            />
            <span>{t("query.export.includeHeaders")}</span>
          </label>

          {status !== "idle" && (
            <div
              className={`csv-export-status csv-export-status-${status}`}
              role="status"
              aria-live="polite"
            >
              {status === "completed" ? (
                <CheckCircle2 size={15} aria-hidden="true" />
              ) : status === "failed" ? (
                <AlertCircle size={15} aria-hidden="true" />
              ) : status === "cancelled" ? (
                <Square size={13} aria-hidden="true" />
              ) : (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              )}
              <div>
                <strong>
                  {status === "choosing"
                    ? t("query.export.choosing")
                    : status === "running"
                      ? t("query.export.running")
                      : status === "cancelling"
                        ? t("query.export.cancelling")
                        : status === "completed"
                          ? t("query.export.completed")
                          : status === "cancelled"
                            ? t("query.export.cancelled")
                            : t("query.export.failed")}
                </strong>
                {status !== "choosing" && status !== "failed" && (
                  <span>{progressLabel}</span>
                )}
              </div>
            </div>
          )}

          {["running", "cancelling"].includes(status) && (
            <progress
              aria-label={t("query.export.progressLabel")}
              value={progress.completedRows}
              max={Math.max(1, progress.totalRows)}
            />
          )}
        </div>

        <footer className="csv-export-footer">
          {status === "running" ? (
            <button
              className="button button-quiet button-compact"
              type="button"
              onClick={() => void cancelExport()}
            >
              <Square size={12} fill="currentColor" />
              {t("query.export.cancel")}
            </button>
          ) : status === "cancelling" || status === "choosing" ? (
            <button
              className="button button-quiet button-compact"
              type="button"
              disabled
            >
              <LoaderCircle className="spin" size={13} />
              {status === "choosing"
                ? t("query.export.choosing")
                : t("query.export.cancelling")}
            </button>
          ) : status === "completed" ? (
            <button
              className="button button-primary button-compact"
              type="button"
              onClick={onClose}
            >
              {t("query.export.done")}
            </button>
          ) : (
            <>
              <button
                className="button button-quiet button-compact"
                type="button"
                onClick={onClose}
              >
                {t("query.export.dismiss")}
              </button>
              <button
                className="button button-primary button-compact"
                type="button"
                disabled={!data}
                onClick={() => void startExport()}
              >
                <FileDown size={13} />
                {t("query.export.save")}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
