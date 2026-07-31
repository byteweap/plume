import { Braces, Copy, FileDown, TableProperties } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  DataGrid,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
  type CellMouseArgs,
  type CellMouseEvent,
  type Column,
  type ColumnWidths,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import type {
  QueryColumn,
  QueryStatementResult,
} from "../query-execution/queryExecution";
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
}

function rowKeyGetter(row: QueryGridRow) {
  return row.rowIndex;
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
): string {
  const presentation = presentQueryResultValue(
    row.values[columnIndex],
    column,
  );
  const isSelected = isPositionSelected(selection, {
    rowIndex: row.rowIndex,
    columnIndex,
  });

  return [
    `query-result-cell-${presentation.kind}`,
    isSelected ? "query-result-cell-selected" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
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
}: QueryResultGridProps) {
  const { t } = useI18n();
  const rows = useMemo(() => buildQueryGridRows(statement), [statement]);
  const [selection, setSelection] = useState<GridSelection>();
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(new Map());
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [exportFormat, setExportFormat] = useState<ResultExportFormat>();
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
      renderCell: ({ row }) => (
        <span title={t("query.results.selectRow")}>{row.rowIndex + 1}</span>
      ),
    };

    return [
      rowNumberColumn,
      ...statement.columns.map((column, columnIndex) => ({
        key: `column-${columnIndex}`,
        name: column.name,
        width: estimateColumnWidth(statement, columnIndex),
        minWidth: 80,
        maxWidth: 560,
        resizable: true,
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
        cellClass: (row: QueryGridRow) =>
          getResultCellClass(row, column, columnIndex, selection),
        renderCell: ({ row }: { row: QueryGridRow }) => {
          const presentation = presentQueryResultValue(
            row.values[columnIndex],
            column,
          );
          return (
            <span
              className={`query-result-value query-result-value-${presentation.kind}`}
              data-query-result-value={presentation.displayText}
              title={presentation.titleText}
            >
              {presentation.displayText}
            </span>
          );
        },
      })),
    ];
  }, [lastColumnIndex, selection, statement, t]);

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
        serializeGridSelection(rows, selection, statement.columns, {
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
          rowKeyGetter={rowKeyGetter}
          rowHeight={rowHeight}
          headerRowHeight={headerRowHeight}
          columnWidths={columnWidths}
          onColumnWidthsChange={setColumnWidths}
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
              serializeGridSelection(rows, selection, statement.columns),
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
