import { Trash2 } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { PendingTableRowDelete } from "./tableDataChanges";

export function TableDataDeleteSummary({
  rows,
}: {
  rows: readonly PendingTableRowDelete[];
}) {
  const { t } = useI18n();
  if (rows.length === 0) return null;
  const summary = t("tableData.deleteSummary").replace(
    "{count}",
    rows.length.toLocaleString(),
  );

  return (
    <section
      className="table-data-delete-summary"
      aria-label={t("tableData.deleteSummaryLabel")}
    >
      <strong>
        <Trash2 size={12} />
        {summary}
      </strong>
      <ol>
        {rows.map((row) => {
          const keyText = row.locator.columns
            .map(
              ({ columnName, value }) =>
                `${columnName}=${formatLocatorValue(value)}`,
            )
            .join(" · ");
          return (
            <li key={row.rowId} title={keyText}>
              <code>{keyText}</code>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function formatLocatorValue(value: string) {
  if (value.length === 0) return "''";
  return value.trim().length === 0 ? JSON.stringify(value) : value;
}
