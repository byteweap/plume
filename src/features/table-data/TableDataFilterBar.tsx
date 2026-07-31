import { Filter, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { QueryColumn } from "../query-execution/queryExecution";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import type {
  TableDataFilter,
  TableDataFilterOperator,
} from "./tableData";
import "./TableDataFilterBar.css";

const operators: TableDataFilterOperator[] = [
  "equals",
  "notEquals",
  "contains",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "isNull",
  "isNotNull",
];

const valueFreeOperators = new Set<TableDataFilterOperator>([
  "isNull",
  "isNotNull",
]);

export function TableDataFilterBar({
  columns,
  filters,
  disabled,
  onApply,
}: {
  columns: QueryColumn[];
  filters: TableDataFilter[];
  disabled: boolean;
  onApply: (filters: TableDataFilter[]) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [drafts, setDrafts] = useState(filters);

  function addFilter() {
    const column = columns[0];
    if (!column) return;
    setDrafts((current) => [
      ...current,
      {
        columnIndex: 0,
        columnName: column.name,
        dataType: column.dataType,
        operator: "equals",
        value: "",
      },
    ]);
  }

  return (
    <section className="table-data-filter-bar" aria-label={t("tableData.filters")}>
      <div className="table-data-filter-summary">
        <button
          className="button button-quiet button-compact"
          type="button"
          disabled={columns.length === 0}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <Filter size={13} />
          {t("tableData.filters")}
          {filters.length > 0 && <span>{filters.length}</span>}
        </button>
        {filters.map((filter, index) => (
          <span className="table-data-filter-chip" key={`${index}:${filter.columnIndex}`}>
            {filter.columnName} · {t(`tableData.filterOperator.${filter.operator}`)}
          </span>
        ))}
      </div>

      {expanded && (
        <div className="table-data-filter-editor">
          {drafts.map((filter, index) => (
            <div className="table-data-filter-row" key={index}>
              <select
                aria-label={t("tableData.filterColumn")}
                value={filter.columnIndex}
                disabled={disabled}
                onChange={(event) => {
                  const columnIndex = Number(event.currentTarget.value);
                  const column = columns[columnIndex];
                  if (!column) return;
                  setDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            columnIndex,
                            columnName: column.name,
                            dataType: column.dataType,
                          }
                        : item,
                    ),
                  );
                }}
              >
                {columns.map((column, columnIndex) => (
                  <option key={`${columnIndex}:${column.name}`} value={columnIndex}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("tableData.filterOperator")}
                value={filter.operator}
                disabled={disabled}
                onChange={(event) => {
                  const operator = event.currentTarget.value as TableDataFilterOperator;
                  setDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, operator } : item,
                    ),
                  );
                }}
              >
                {operators.map((operator) => (
                  <option key={operator} value={operator}>
                    {t(`tableData.filterOperator.${operator}`)}
                  </option>
                ))}
              </select>
              <input
                aria-label={t("tableData.filterValue")}
                value={filter.value}
                disabled={disabled || valueFreeOperators.has(filter.operator)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDrafts((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, value } : item,
                    ),
                  );
                }}
              />
              <IconButton
                label={t("tableData.removeFilter")}
                disabled={disabled}
                onClick={() =>
                  setDrafts((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}

          <footer>
            <button
              className="button button-quiet button-compact"
              type="button"
              disabled={disabled || columns.length === 0}
              onClick={addFilter}
            >
              <Plus size={13} />
              {t("tableData.addFilter")}
            </button>
            <span />
            <button
              className="button button-quiet button-compact"
              type="button"
              disabled={disabled || (filters.length === 0 && drafts.length === 0)}
              onClick={() => {
                setDrafts([]);
                onApply([]);
                setExpanded(false);
              }}
            >
              {t("tableData.clearFilters")}
            </button>
            <button
              className="button button-primary button-compact"
              type="button"
              disabled={disabled}
              onClick={() => {
                onApply(drafts);
                setExpanded(false);
              }}
            >
              {t("tableData.applyFilters")}
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}
