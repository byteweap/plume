import { Clipboard, RefreshCw, Search, Trash2 } from "lucide-react";
import type { QueryHistory } from "./queryHistory";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";

export function QueryHistoryPanel({
  entries,
  search,
  onSearchChange,
  onRefresh,
  onClear,
  onOpen,
  onCopy,
}: {
  entries: QueryHistory[];
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onClear: () => void;
  onOpen: (entry: QueryHistory) => void;
  onCopy: (entry: QueryHistory) => void;
}) {
  const { locale, t } = useI18n();

  return (
    <section className="history-panel" aria-label={t("history.title")}>
      <header className="history-heading">
        <span>{t("history.title")}</span>
        <div className="history-actions">
          <IconButton label={t("history.refresh")} onClick={onRefresh}>
            <RefreshCw size={14} />
          </IconButton>
          <IconButton label={t("history.clear")} onClick={onClear}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </header>
      <label className="sidebar-search history-search">
        <Search size={14} />
        <input
          aria-label={t("history.search")}
          placeholder={t("history.search")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      <div className="history-list">
        {entries.length === 0 ? (
          <div className="history-empty">{t("history.empty")}</div>
        ) : (
          entries.map((entry) => (
            <div className="history-item" key={entry.id}>
              <button
                className="history-item-open"
                type="button"
                title={entry.sql}
                onClick={() => onOpen(entry)}
              >
                <span className={`history-status history-status-${entry.resultStatus}`} />
                <span className="history-item-copy">
                  <strong>{entry.sql.replace(/\s+/g, " ").trim()}</strong>
                  <small>
                    {entry.database} · {formatHistoryTime(entry.executedAt, locale)}
                  </small>
                </span>
              </button>
              <IconButton label={t("history.copy")} onClick={() => onCopy(entry)}>
                <Clipboard size={13} />
              </IconButton>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatHistoryTime(timestamp: number, locale: string) {
  return new Date(timestamp * 1000).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
