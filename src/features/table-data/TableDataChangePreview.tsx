import { FilePenLine, LocateFixed, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { QueryColumn, QueryValue } from "../query-execution/queryExecution";
import { useI18n } from "../../i18n/I18nContext";
import {
  hasPendingTableDataChanges,
  summarizeTableDataChanges,
  type PendingTableValue,
  type TableDataChangeSet,
} from "./tableDataChanges";
import "./TableDataChangePreview.css";

export interface TableDataChangeTarget {
  pageIndex: number;
  rowIndex?: number;
  localId?: string;
  columnIndex: number;
}

export function TableDataChangePreview({
  changes,
  columns,
  onNavigate,
}: {
  changes: TableDataChangeSet;
  columns: readonly QueryColumn[];
  onNavigate: (target: TableDataChangeTarget) => void;
}) {
  const { t } = useI18n();
  if (!hasPendingTableDataChanges(changes)) return null;

  const summary = summarizeTableDataChanges(changes);
  const summaryText = t("tableData.changePreview.summary")
    .replace("{rows}", summary.totalRows.toLocaleString())
    .replace("{cells}", summary.updatedCells.toLocaleString());

  return (
    <details className="table-data-change-preview" open>
      <summary>
        <strong>{t("tableData.changePreview.title")}</strong>
        <span>{summaryText}</span>
        <span className="table-data-change-count table-data-change-count-insert">
          +{summary.insertedRows.toLocaleString()}
        </span>
        <span className="table-data-change-count table-data-change-count-update">
          ~{summary.updatedRows.toLocaleString()}
        </span>
        <span className="table-data-change-count table-data-change-count-delete">
          -{summary.deletedRows.toLocaleString()}
        </span>
      </summary>
      <div className="table-data-change-groups">
        {changes.insertedRows.length > 0 && (
          <ChangeGroup
            icon={<Plus size={12} />}
            label={formatCount(
              t("tableData.changePreview.inserted"),
              changes.insertedRows.length,
            )}
          >
            {changes.insertedRows.map((row, rowOffset) => (
              <div className="table-data-change-row" key={row.localId}>
                <span>
                  {t("tableData.changePreview.newRow").replace(
                    "{number}",
                    (rowOffset + 1).toLocaleString(),
                  )}
                </span>
                {row.values.map((value, columnIndex) => (
                  <ChangeTargetButton
                    key={columnIndex}
                    label={`${columns[columnIndex]?.name ?? columnIndex + 1}=${formatPendingValue(value)}`}
                    location={formatPage(
                      t("tableData.changePreview.newRowLocation"),
                      row.pageIndex,
                    )}
                    onClick={() =>
                      onNavigate({
                        pageIndex: row.pageIndex,
                        localId: row.localId,
                        columnIndex,
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </ChangeGroup>
        )}

        {changes.updatedRows.length > 0 && (
          <ChangeGroup
            icon={<FilePenLine size={12} />}
            label={formatCount(
              t("tableData.changePreview.updated"),
              summary.updatedCells,
            )}
          >
            {changes.updatedRows.flatMap((row) =>
              row.cells.map((cell) => (
                <ChangeTargetButton
                  key={`${row.rowId}:${cell.columnIndex}`}
                  label={`${cell.columnName}: ${formatQueryValue(cell.originalValue)} -> ${formatPendingValue(cell.newValue)}`}
                  location={formatLocation(
                    t("tableData.changePreview.location"),
                    row.pageIndex,
                    row.rowIndex,
                  )}
                  onClick={() =>
                    onNavigate({
                      pageIndex: row.pageIndex,
                      rowIndex: row.rowIndex,
                      columnIndex: cell.columnIndex,
                    })
                  }
                />
              )),
            )}
          </ChangeGroup>
        )}

        {changes.deletedRows.length > 0 && (
          <ChangeGroup
            icon={<Trash2 size={12} />}
            label={formatCount(
              t("tableData.changePreview.deleted"),
              changes.deletedRows.length,
            )}
          >
            {changes.deletedRows.map((row) => {
              const firstKeyColumn = row.locator.columns[0]?.columnName;
              const columnIndex = Math.max(
                0,
                columns.findIndex((column) => column.name === firstKeyColumn),
              );
              return (
                <ChangeTargetButton
                  key={row.rowId}
                  label={row.locator.columns
                    .map(
                      ({ columnName, value }) =>
                        `${columnName}=${formatQueryValue(value)}`,
                    )
                    .join(" · ")}
                  location={formatLocation(
                    t("tableData.changePreview.location"),
                    row.pageIndex,
                    row.rowIndex,
                  )}
                  onClick={() =>
                    onNavigate({
                      pageIndex: row.pageIndex,
                      rowIndex: row.rowIndex,
                      columnIndex,
                    })
                  }
                />
              );
            })}
          </ChangeGroup>
        )}
      </div>
    </details>
  );
}

function ChangeGroup({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="table-data-change-group" aria-label={label}>
      <h2>
        {icon}
        {label}
      </h2>
      <div className="table-data-change-items">{children}</div>
    </section>
  );
}

function ChangeTargetButton({
  label,
  location,
  onClick,
}: {
  label: string;
  location: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const title = `${t("tableData.changePreview.jump")}: ${location} · ${label}`;
  return (
    <button
      className="table-data-change-target"
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <LocateFixed size={11} aria-hidden="true" />
      <code>{label}</code>
      <small>{location}</small>
    </button>
  );
}

function formatCount(template: string, count: number) {
  return template.replace("{count}", count.toLocaleString());
}

function formatPage(template: string, pageIndex: number) {
  return template.replace(
    "{page}",
    (pageIndex + 1).toLocaleString(),
  );
}

function formatLocation(
  template: string,
  pageIndex: number,
  rowIndex: number,
) {
  return template
    .replace("{page}", (pageIndex + 1).toLocaleString())
    .replace("{row}", (rowIndex + 1).toLocaleString());
}

function formatPendingValue(value: PendingTableValue) {
  if (value.kind === "default") return "DEFAULT";
  if (value.kind === "null") return "NULL";
  return formatQueryValue(value.value);
}

function formatQueryValue(value: QueryValue) {
  if (value === null) return "NULL";
  if (value.length === 0) return "''";
  return value.trim().length === 0 ? JSON.stringify(value) : value;
}
