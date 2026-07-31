import { AlertTriangle, Save, Undo2, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import type { TableDataChangeSet } from "./tableDataChanges";
import { summarizeTableDataChanges } from "./tableDataChanges";
import "./TableDataLeaveDialog.css";

export interface PendingTableDataLeaveItem {
  id: string;
  database: string;
  schema: string;
  table: string;
  changes: TableDataChangeSet;
}

export function TableDataLeaveDialog({
  items,
  status,
  error,
  onCommit,
  onDiscard,
  onCancel,
}: {
  items: readonly PendingTableDataLeaveItem[];
  status: "idle" | "committing" | "failed";
  error?: string;
  onCommit: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const busy = status === "committing";

  return (
    <div className="table-data-leave-backdrop" role="presentation">
      <section
        className="table-data-leave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-data-leave-title"
      >
        <header>
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <h2 id="table-data-leave-title">{t("tableData.leave.title")}</h2>
            <p>{t("tableData.leave.body")}</p>
          </div>
          <IconButton
            label={t("tableData.leave.cancel")}
            disabled={busy}
            onClick={onCancel}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="table-data-leave-list">
          {items.map((item) => {
            const summary = summarizeTableDataChanges(item.changes);
            return (
              <div className="table-data-leave-item" key={item.id}>
                <strong>{item.table}</strong>
                <span>
                  {item.database} / {item.schema}
                </span>
                <small>
                  {t("tableData.leave.summary")
                    .replace("{inserted}", summary.insertedRows.toLocaleString())
                    .replace("{updated}", summary.updatedRows.toLocaleString())
                    .replace("{deleted}", summary.deletedRows.toLocaleString())}
                </small>
              </div>
            );
          })}
        </div>

        {status === "failed" && error && (
          <div className="table-data-leave-error" role="alert">
            <strong>{t("tableData.leave.commitFailed")}</strong>
            <span>{error}</span>
          </div>
        )}

        <footer>
          <button
            className="button button-quiet button-compact"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            {t("tableData.leave.cancel")}
          </button>
          <button
            className="button button-quiet button-compact table-data-leave-discard"
            type="button"
            disabled={busy}
            onClick={onDiscard}
          >
            <Undo2 size={13} />
            {t("tableData.leave.discard")}
          </button>
          <button
            className="button button-primary button-compact"
            type="button"
            disabled={busy}
            onClick={onCommit}
          >
            <Save size={13} />
            {busy ? t("tableData.commit.running") : t("tableData.leave.commit")}
          </button>
        </footer>
      </section>
    </div>
  );
}
