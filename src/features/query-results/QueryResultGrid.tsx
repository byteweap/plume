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
import type { QueryStatementResult } from "../query-execution/queryExecution";
import {
  buildQueryGridRows,
  formatQueryValue,
  isPositionSelected,
  serializeGridSelection,
  type GridPosition,
  type GridSelection,
  type QueryGridRow,
} from "./queryResultRows";
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
  const headerLength = statement.columns[columnIndex]?.name.length ?? 0;
  let contentLength = headerLength;
  let sampled = 0;

  for (const batch of statement.batches) {
    for (const row of batch.rows) {
      contentLength = Math.max(
        contentLength,
        Math.min(formatQueryValue(row[columnIndex]).length, 42),
      );
      sampled += 1;
      if (sampled === 24) break;
    }
    if (sampled === 24) break;
  }

  return Math.min(360, Math.max(104, contentLength * 7 + 32));
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

export function QueryResultGrid({
  statement,
  label,
  emptyLabel,
}: QueryResultGridProps) {
  const rows = useMemo(() => buildQueryGridRows(statement), [statement]);
  const [selection, setSelection] = useState<GridSelection>();
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(new Map());
  const extendingSelection = useRef(false);

  const columns = useMemo((): Column<QueryGridRow>[] => {
    const rowNumberColumn: Column<QueryGridRow> = {
      key: rowNumberColumnKey,
      name: "#",
      width: 54,
      minWidth: 54,
      maxWidth: 54,
      frozen: true,
      cellClass: (row) =>
        isPositionSelected(selection, {
          rowIndex: row.rowIndex,
          columnIndex: -1,
        })
          ? "query-result-cell-selected query-result-row-number"
          : "query-result-row-number",
      renderCell: ({ row }) => row.rowIndex + 1,
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
        cellClass: (row: QueryGridRow) =>
          isPositionSelected(selection, {
            rowIndex: row.rowIndex,
            columnIndex,
          })
            ? "query-result-cell-selected"
            : undefined,
        renderCell: ({ row }: { row: QueryGridRow }) => {
          const value = row.values[columnIndex];
          const text = formatQueryValue(value);
          return (
            <span
              className={value === null ? "query-result-null" : undefined}
              title={text}
            >
              {text}
            </span>
          );
        },
      })),
    ];
  }, [selection, statement]);

  function updateSelection(position: GridPosition) {
    const shouldExtend = extendingSelection.current;
    extendingSelection.current = false;
    setSelection((current) =>
      shouldExtend && current
        ? { anchor: current.anchor, focus: position }
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
    if (!event.shiftKey || !selection) return;

    extendNextSelection();
    event.preventGridDefault();
    args.selectCell();
  }

  function handleCellKeyDown(
    _args: CellKeyDownArgs<QueryGridRow>,
    event: CellKeyboardEvent,
  ) {
    if (event.shiftKey && isRangeNavigationKey(event.key)) {
      extendNextSelection();
    } else {
      extendingSelection.current = false;
    }
  }

  return (
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
          serializeGridSelection(rows, selection),
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
  );
}
