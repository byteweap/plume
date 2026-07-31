import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nContext";
import type { LocalDataScope } from "./localData";

const scopes: LocalDataScope[] = ["history", "drafts", "cache", "all"];

export function LocalDataPanel({
  busy,
  onClear,
}: {
  busy: boolean;
  onClear: (scope: LocalDataScope) => void;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<LocalDataScope>("history");

  return (
    <section className="local-data-panel" aria-label={t("localData.title")}>
      <span className="local-data-title">{t("localData.title")}</span>
      <div className="local-data-control">
        <label>
          <select
            aria-label={t("localData.scope")}
            value={scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value as LocalDataScope)}
          >
            {scopes.map((item) => (
              <option key={item} value={item}>
                {t(`localData.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-danger button-compact"
          type="button"
          disabled={busy}
          onClick={() => onClear(scope)}
        >
          <Trash2 size={13} />
          {busy ? t("localData.clearing") : t("localData.clear")}
        </button>
      </div>
    </section>
  );
}
