import { Braces, Copy, FileDown, TableProperties, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
  type CellMouseArgs,
  type CellMouseEvent,
  type Column,
  type ColumnWidths,
  type RenderEditCellProps,
  type SortColumn,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import type {
  QueryColumn,
  QueryStatementResult,
} from "../query-execution/queryExecution";
import type { PendingTableValue } from "../table-data/tableDataChanges";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import {
  buildQueryGridRows,
  getSelectionBounds,
  isPositionSelected,
  serializeGridSelection,
  type GridPosition,
  type GridSelection,
  type QueryGridRow,
} from "./queryResultRows";
import { presentQueryResultValue } from "./queryResultValue";
import { QueryResultCellEditor } from "./QueryResultCellEditor";
import {
  ResultExportDialog,
  type ResultExportFormat,
} from "./ResultExportDialog";
import "./QueryResults.css";

const rowNumberColumnKey = "__row_number__";
const rowHeight = 28;
const headerRowHeight = 30;

export interface QueryResultGridProps {
  statement: QueryStatementResult;
  label: string;
  emptyLabel: string;
  sorts?: QueryResultSort[];
  onSortsChange?: (sorts: QueryResultSort[]) => void;
  editing?: QueryResultGridEditing;
}

export interface QueryResultGridEditing {
  insertedRows: Array<{ localId: string; values: PendingTableValue[] }>;
  getPendingValue: (
    row: QueryGridRow,
    columnIndex: number,
  ) => PendingTableValue | undefined;
  onCellValueChange: (
    row: QueryGridRow,
    columnIndex: number,
    value: PendingTableValue,
  ) => void;
  onDiscardInsertedRow: (localId: string) => void;
}

export interface QueryResultSort {
  columnIndex: number;
  direction: "ASC" | "DESC";
}

function rowKeyGetter(row: QueryGridRow) {
  return row.rowKey ?? row.rowIndex;
}

function columnIndexFromKey(key: string): number {
  return key === rowNumberColumnKey ? -1 : Number(key.slice("column-".length));
}

function estimateColumnWidth(
  statement: QueryStatementResult,
  columnIndex: number,
): number {
  const column = statement.columns[columnIndex];
  if (!column) return 104;

  const headerLength = Math.max(
    column.name.length,
    getDataTypeLabel(column)?.length ?? 0,
  );
  let contentLength = headerLength;
  let sampled = 0;

  for (const batch of statement.batches) {
    for (const row of batch.rows) {
      contentLength = Math.max(
        contentLength,
        Math.min(
          presentQueryResultValue(row[columnIndex], column).displayText.length,
          42,
        ),
      );
      sampled += 1;
      if (sampled === 24) break;
    }
    if (sampled === 24) break;
  }

  return Math.min(360, Math.max(104, contentLength * 7 + 32));
}

function getDataTypeLabel(column: QueryColumn): string | undefined {
  const name = column.dataType.name;
  if (!name) return undefined;

  const schema = column.dataType.schema;
  return schema && schema !== "pg_catalog" ? `${schema}.${name}` : name;
}

function getResultCellClass(
  row: QueryGridRow,
  column: QueryColumn,
  columnIndex: number,
  selection: GridSelection | undefined,
  pendingValue?: PendingTableValue,
): string {
  const presentation = presentGridCellValue(
    row.values[columnIndex],
    column,
    pendingValue,
  );
  const isSelected = isPositionSelected(selection, {
    rowIndex: row.rowIndex,
    columnIndex,
  });

  return [
    `query-result-cell-${presentation.kind}`,
    pendingValue ? "query-result-cell-pending" : undefined,
    row.insertedId ? "query-result-cell-inserted" : undefined,
    isSelected ? "query-result-cell-selected" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function presentGridCellValue(
  originalValue: QueryGridRow["values"][number] | undefined,
  column: QueryColumn,
  pendingValue?: PendingTableValue,
) {
  if (pendingValue?.kind === "default") {
    return {
      kind: "default",
      displayText: "DEFAULT",
      titleText: "DEFAULT",
    };
  }
  const value =
    pendingValue?.kind === "value"
      ? pendingValue.value
      : pendingValue?.kind === "null"
        ? null
        : originalValue;
  return presentQueryResultValue(value, column);
}

function isRangeNavigationKey(key: string) {
  return [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ].includes(key);
}

function isVerticalNavigationKey(key: string) {
  return ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(
    key,
  );
}

function isWholeRowSelected(
  selection: GridSelection | undefined,
  rowIndex: number,
  lastColumnIndex: number,
) {
  if (!selection || lastColumnIndex < 0) return false;

  const bounds = getSelectionBounds(selection);
  return (
    bounds.firstColumnIndex === 0 &&
    bounds.lastColumnIndex === lastColumnIndex &&
    rowIndex >= bounds.firstRowIndex &&
    rowIndex <= bounds.lastRowIndex
  );
}

export function QueryResultGrid({
  statement,
  label,
  emptyLabel,
  sorts = [],
  onSortsChange,
  editing,
}: QueryResultGridProps) {
  const { t } = useI18n();
  const rows = useMemo(() => {
    const loadedRows = buildQueryGridRows(statement);
    const nextRowIndex =
      loadedRows.reduce((maximum, row) => Math.max(maximum, row.rowIndex), -1) + 1;
    const insertedRows = (editing?.insertedRows ?? []).map((row, index) => ({
      rowIndex: nextRowIndex + index,
      rowKey: `inserted:${row.localId}`,
      insertedId: row.localId,
      values: row.values.map((value) =>
        value.kind === "value" ? value.value : null,
      ),
    }));
    return [...loadedRows, ...insertedRows];
  }, [editing?.insertedRows, statement]);
  const copyRows = useMemo(
    () =>
      editing
        ? rows.map((row) => ({
            ...row,
            values: row.values.map((value, columnIndex) => {
              const pendingValue = editing.getPendingValue(row, columnIndex);
              return pendingValue?.kind === "default"
                ? "DEFAULT"
                : pendingValue?.kind === "null"
                  ? null
                  : pendingValue?.kind === "value"
                    ? pendingValue.value
                    : value;
            }),
          }))
        : rows,
    [editing, rows],
  );
  const [selection, setSelection] = useState<GridSelection>();
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(new Map());
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [exportFormat, setExportFormat] = useState<ResultExportFormat>();
  const sortable = Boolean(onSortsChange);
  const extendingSelection = useRef(false);
  const selectingRows = useRef(false);
  const lastColumnIndex = statement.columns.length - 1;

  const columns = useMemo((): Column<QueryGridRow>[] => {
    const rowNumberColumn: Column<QueryGridRow> = {
      key: rowNumberColumnKey,
      name: "#",
      width: 54,
      minWidth: 54,
      maxWidth: 54,
      frozen: true,
      cellClass: (row) =>
        isWholeRowSelected(selection, row.rowIndex, lastColumnIndex) ||
        isPositionSelected(selection, {
          rowIndex: row.rowIndex,
          columnIndex: -1,
        })
          ? "query-result-cell-selected query-result-row-number"
          : "query-result-row-number",
      renderCell: ({ row }) =>
        row.insertedId && editing ? (
          <IconButton
            className="query-result-discard-row"
            label={t("tableData.discardNewRow")}
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              editing.onDiscardInsertedRow(row.insertedId!);
            }}
          >
            <X size={12} />
          </IconButton>
        ) : (
          <span title={t("query.results.selectRow")}>{row.rowIndex + 1}</span>
        ),
    };

    return [
      rowNumberColumn,
      ...statement.columns.map((column, columnIndex) => ({
        key: `column-${columnIndex}`,
        name: column.name,
        width: estimateColumnWidth(statement, columnIndex),
        minWidth: editing ? 220 : 80,
        maxWidth: 560,
        resizable: true,
        sortable,
        renderHeaderCell: () => {
          const dataTypeLabel = getDataTypeLabel(column);
          return (
            <span
              className="query-result-column-header"
              title={
                dataTypeLabel
                  ? `${column.name} (${dataTypeLabel})`
                  : column.name
              }
            >
              <span>{column.name}</span>
              {dataTypeLabel && <small>{dataTypeLabel}</small>}
            </span>
          );
        },
        cellClass: (row: QueryGridRow) => {
          const pendingValue = editing?.getPendingValue(row, columnIndex);
          return getResultCellClass(
            row,
            column,
            columnIndex,
            selection,
            pendingValue,
          );
        },
        renderCell: ({ row }: { row: QueryGridRow }) => {
          const pendingValue = editing?.getPendingValue(row, columnIndex);
          const presentation = presentGridCellValue(
            row.values[columnIndex],
            column,
            pendingValue,
          );
          const originalPresentation = presentQueryResultValue(
            row.values[columnIndex],
            column,
          );
          const titleText = pendingValue
            ? row.insertedId
              ? `${t("tableData.editor.staged")}: ${presentation.displayText}`
              : `${t("tableData.editor.original")}: ${originalPresentation.displayText}\n${t("tableData.editor.staged")}: ${presentation.displayText}`
            : presentation.titleText;
          return (
            <span
              className={`query-result-value query-result-value-${presentation.kind}`}
              data-query-result-value={presentation.displayText}
              data-query-result-original-value={
                pendingValue ? originalPresentation.displayText : undefined
              }
              title={titleText}
            >
              {presentation.displayText}
            </span>
          );
        },
        ...(editing
          ? {
              editable: true,
              editorOptions: { commitOnOutsideClick: false },
              renderEditCell: ({
                row,
                onClose,
              }: RenderEditCellProps<QueryGridRow>) => (
                <QueryResultCellEditor
                  column={column}
                  originalValue={row.values[columnIndex] ?? null}
                  pendingValue={editing.getPendingValue(row, columnIndex)}
                  onCommit={(value) =>
                    editing.onCellValueChange(row, columnIndex, value)
                  }
                  onClose={() => onClose(false, true)}
                />
              ),
            }
          : {}),
      })),
    ];
  }, [editing, lastColumnIndex, selection, sortable, statement, t]);
  const sortColumns = useMemo<readonly SortColumn[]>(
    () =>
      sorts.map((sort) => ({
        columnKey: `column-${sort.columnIndex}`,
        direction: sort.direction,
      })),
    [sorts],
  );

  function updateSelection(position: GridPosition) {
    const shouldExtend = extendingSelection.current;
    const shouldSelectRows = selectingRows.current && lastColumnIndex >= 0;
    extendingSelection.current = false;
    selectingRows.current = false;
    setCopyStatus("idle");
    setSelection((current) =>
      shouldExtend && current
        ? {
            anchor: current.anchor,
            focus: shouldSelectRows
              ? { ...position, columnIndex: lastColumnIndex }
              : position,
          }
        : shouldSelectRows
          ? {
              anchor: { ...position, columnIndex: 0 },
              focus: { ...position, columnIndex: lastColumnIndex },
            }
          : { anchor: position, focus: position },
    );
  }

  function extendNextSelection() {
    extendingSelection.current = true;
    queueMicrotask(() => {
      extendingSelection.current = false;
    });
  }

  function handleCellMouseDown(
    args: CellMouseArgs<QueryGridRow>,
    event: CellMouseEvent,
  ) {
    selectingRows.current = args.column.key === rowNumberColumnKey;
    if (!event.shiftKey || !selection) return;

    extendNextSelection();
    event.preventGridDefault();
    args.selectCell();
  }

  function handleCellKeyDown(
    args: CellKeyDownArgs<QueryGridRow>,
    event: CellKeyboardEvent,
  ) {
    selectingRows.current =
      args.column.key === rowNumberColumnKey &&
      isVerticalNavigationKey(event.key);
    if (event.shiftKey && isRangeNavigationKey(event.key)) {
      extendNextSelection();
    } else {
      extendingSelection.current = false;
    }
  }

  async function copySelection(includeHeaders: boolean) {
    if (!selection) return;

    try {
      await navigator.clipboard.writeText(
        serializeGridSelection(copyRows, selection, statement.columns, {
          includeHeaders,
        }),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <>
      <div className="query-result-grid-shell">
        <div className="query-result-copybar">
          <span className="query-result-copy-status" aria-live="polite">
            {copyStatus === "copied"
              ? t("query.results.copied")
              : copyStatus === "failed"
                ? t("query.results.copyFailed")
                : ""}
          </span>
          <IconButton
            className="query-result-copy-button"
            label={t("query.results.copySelection")}
            disabled={!selection}
            onClick={() => void copySelection(false)}
          >
            <Copy size={13} />
          </IconButton>
          <IconButton
            className="query-result-copy-button"
            label={t("query.results.copyWithHeaders")}
            disabled={!selection}
            onClick={() => void copySelection(true)}
          >
            <TableProperties size={13} />
          </IconButton>
          <IconButton
            className="query-result-copy-button"
            label={t("query.export.open")}
            disabled={rows.length === 0 || statement.columns.length === 0}
            onClick={() => setExportFormat("csv")}
          >
            <FileDown size={13} />
          </IconButton>
          <IconButton
            className="query-result-copy-button"
            label={t("query.export.jsonOpen")}
            disabled={rows.length === 0 || statement.columns.length === 0}
            onClick={() => setExportFormat("json")}
          >
            <Braces size={13} />
          </IconButton>
        </div>
        <DataGrid
          aria-label={label}
          className="query-result-grid"
          columns={columns}
          rows={rows}
          onRowsChange={editing ? () => undefined : undefined}
          rowKeyGetter={rowKeyGetter}
          rowHeight={rowHeight}
          headerRowHeight={headerRowHeight}
          columnWidths={columnWidths}
          onColumnWidthsChange={setColumnWidths}
          sortColumns={sortColumns}
          onSortColumnsChange={(nextSortColumns) =>
            onSortsChange?.(
              nextSortColumns
                .map((sort) => ({
                  columnIndex: columnIndexFromKey(sort.columnKey),
                  direction: sort.direction,
                }))
                .filter((sort) => sort.columnIndex >= 0),
            )
          }
          onCellMouseDown={handleCellMouseDown}
          onCellKeyDown={handleCellKeyDown}
          onSelectedCellChange={({ rowIdx, column }) => {
            updateSelection({
              rowIndex: rows[rowIdx]?.rowIndex ?? rowIdx,
              columnIndex: columnIndexFromKey(column.key),
            });
          }}
          onCellCopy={(_args, event) => {
            if (!selection) return;
            event.preventDefault();
            event.clipboardData.setData(
              "text/plain",
              serializeGridSelection(copyRows, selection, statement.columns),
            );
          }}
          renderers={{
            noRowsFallback: (
              <div className="query-result-empty" role="status">
                {emptyLabel}
              </div>
            ),
          }}
        />
      </div>
      {exportFormat && (
        <ResultExportDialog
          format={exportFormat}
          statement={statement}
          selection={selection}
          onClose={() => setExportFormat(undefined)}
        />
      )}
    </>
  );
}
