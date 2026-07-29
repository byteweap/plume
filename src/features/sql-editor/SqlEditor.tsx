import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  createSqlEditor,
  type SqlEditorController,
} from "./sqlEditorController";
import type { SqlCompletionConnection } from "./sqlCompletion";
import "./SqlEditor.css";

export type {
  SqlEditorController,
  SqlExecutionScope,
  SqlExecutionSource,
  SqlExecutionTarget,
} from "./sqlEditorController";

interface SqlEditorProps {
  label: string;
  value: string;
  completionConnection?: SqlCompletionConnection;
  onChange: (value: string) => void;
}

export const SqlEditor = forwardRef<SqlEditorController, SqlEditorProps>(
  function SqlEditor(
    { label, value, completionConnection, onChange },
    forwardedRef,
  ) {
    const parentRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<SqlEditorController | null>(null);
    const onChangeRef = useRef(onChange);
    const initialOptionsRef = useRef({ label, value, completionConnection });
    onChangeRef.current = onChange;

    useImperativeHandle(forwardedRef, () => ({
      getValue: () => controllerRef.current?.getValue() ?? value,
      getExecutionTarget: (scope) =>
        controllerRef.current?.getExecutionTarget(scope) ?? null,
      setValue: (nextValue) => controllerRef.current?.setValue(nextValue),
      replaceSelection: (replacement) =>
        controllerRef.current?.replaceSelection(replacement),
      revealError: (range) => controllerRef.current?.revealError(range),
      setCompletionConnection: (connection) =>
        controllerRef.current?.setCompletionConnection(connection),
      setLabel: (nextLabel) => controllerRef.current?.setLabel(nextLabel),
      focus: () => controllerRef.current?.focus(),
      destroy: () => controllerRef.current?.destroy(),
    }));

    useEffect(() => {
      const parent = parentRef.current;
      if (!parent) return;

      const controller = createSqlEditor(parent, {
        ...initialOptionsRef.current,
        onChange: (nextValue) => onChangeRef.current(nextValue),
      });
      controllerRef.current = controller;
      return () => {
        controllerRef.current = null;
        controller.destroy();
      };
    }, []);

    useEffect(() => {
      controllerRef.current?.setValue(value);
    }, [value]);

    useEffect(() => {
      controllerRef.current?.setLabel(label);
    }, [label]);

    useEffect(() => {
      controllerRef.current?.setCompletionConnection(completionConnection);
    }, [completionConnection]);

    return <div className="sql-editor" ref={parentRef} />;
  },
);
