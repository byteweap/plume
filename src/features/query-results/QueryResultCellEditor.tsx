import { Check, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useI18n } from "../../i18n/I18nContext";
import { IconButton } from "../../shared/IconButton";
import type {
  QueryColumn,
  QueryValue,
} from "../query-execution/queryExecution";
import type { PendingTableValue } from "../table-data/tableDataChanges";

interface QueryResultCellEditorProps {
  column: QueryColumn;
  originalValue: QueryValue;
  pendingValue?: PendingTableValue;
  onCommit: (value: PendingTableValue) => void;
  onClose: () => void;
}

type EditorMode = PendingTableValue["kind"];

export function QueryResultCellEditor({
  column,
  originalValue,
  pendingValue,
  onCommit,
  onClose,
}: QueryResultCellEditorProps) {
  const { t } = useI18n();
  const initialMode: EditorMode =
    pendingValue?.kind ?? (originalValue === null ? "null" : "value");
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [text, setText] = useState(
    pendingValue?.kind === "value" ? pendingValue.value : (originalValue ?? ""),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const finished = useRef(false);
  const inputLabel = t("tableData.editor.input").replace("{column}", column.name);
  const dataType = column.dataType.name;

  useEffect(() => {
    if (mode === "value") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      selectRef.current?.focus();
    }
  }, [mode]);

  function commit() {
    if (finished.current) return;
    finished.current = true;
    onCommit(mode === "value" ? { kind: "value", value: text } : { kind: mode });
    onClose();
  }

  function cancel() {
    if (finished.current) return;
    finished.current = true;
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) commit();
  }

  return (
    <div
      className="query-result-cell-editor"
      data-editor-type={dataType}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <select
        ref={selectRef}
        aria-label={t("tableData.editor.mode")}
        title={dataType}
        value={mode}
        onChange={(event) => setMode(event.currentTarget.value as EditorMode)}
      >
        <option value="value">{t("tableData.editor.value")}</option>
        <option value="null">{t("tableData.editor.null")}</option>
        <option value="default">{t("tableData.editor.default")}</option>
      </select>
      <input
        ref={inputRef}
        aria-label={inputLabel}
        disabled={mode !== "value"}
        value={mode === "value" ? text : mode.toUpperCase()}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <IconButton
        className="query-result-editor-action"
        label={t("tableData.editor.apply")}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={commit}
      >
        <Check size={12} />
      </IconButton>
      <IconButton
        className="query-result-editor-action"
        label={t("tableData.editor.cancel")}
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={cancel}
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}
