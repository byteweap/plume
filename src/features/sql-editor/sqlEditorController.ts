import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { basicSetup, EditorView } from "codemirror";
import {
  resolveSqlExecutionTarget,
  type SqlExecutionScope,
  type SqlExecutionTarget,
} from "./sqlExecutionTarget";

export type {
  SqlExecutionScope,
  SqlExecutionSource,
  SqlExecutionTarget,
} from "./sqlExecutionTarget";

export interface SqlEditorController {
  getValue(): string;
  getExecutionTarget(scope?: SqlExecutionScope): SqlExecutionTarget | null;
  setValue(value: string): void;
  replaceSelection(value: string): void;
  setLabel(label: string): void;
  focus(): void;
  destroy(): void;
}

export interface SqlEditorOptions {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function createSqlEditor(
  parent: HTMLElement,
  options: SqlEditorOptions,
): SqlEditorController {
  let notifyChanges = true;
  const view = new EditorView({
    doc: options.value,
    parent,
    extensions: [
      basicSetup,
      sql({ dialect: PostgreSQL }),
      EditorView.contentAttributes.of({
        "aria-label": options.label,
        "aria-multiline": "true",
      }),
      EditorView.updateListener.of((update) => {
        if (notifyChanges && update.docChanged) {
          options.onChange(update.state.doc.toString());
        }
      }),
    ],
  });

  return {
    getValue: () => view.state.doc.toString(),
    getExecutionTarget: (scope) => resolveSqlExecutionTarget(view.state, scope),
    setValue(value) {
      if (value === view.state.doc.toString()) return;
      notifyChanges = false;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      } finally {
        notifyChanges = true;
      }
    },
    replaceSelection(value) {
      view.dispatch(view.state.replaceSelection(value));
    },
    setLabel(label) {
      view.contentDOM.setAttribute("aria-label", label);
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
