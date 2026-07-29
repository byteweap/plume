import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type SqlExecutionScope = "current" | "all";
export type SqlExecutionSource = "selection" | "statement" | "document";

export interface SqlExecutionTarget {
  sql: string;
  from: number;
  to: number;
  source: SqlExecutionSource;
}

interface SqlRange {
  from: number;
  to: number;
}

function trimRange(document: string, range: SqlRange): SqlRange | null {
  const value = document.slice(range.from, range.to);
  const startTrimmed = value.trimStart();
  const trimmed = startTrimmed.trimEnd();

  if (!trimmed) return null;

  const from = range.from + value.length - startTrimmed.length;
  return { from, to: from + trimmed.length };
}

function createTarget(
  document: string,
  range: SqlRange,
  source: SqlExecutionSource,
): SqlExecutionTarget | null {
  const trimmedRange = trimRange(document, range);
  if (!trimmedRange) return null;

  return {
    sql: document.slice(trimmedRange.from, trimmedRange.to),
    ...trimmedRange,
    source,
  };
}

function getStatementRanges(state: EditorState): SqlRange[] {
  const tree =
    ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  const statements: SqlRange[] = [];

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === "Statement") {
      statements.push({ from: node.from, to: node.to });
    }
  }

  return statements.map((statement, index) => ({
    from: index === 0 ? 0 : statements[index - 1]!.to,
    to: index === statements.length - 1 ? state.doc.length : statement.to,
  }));
}

export function resolveSqlExecutionTarget(
  state: EditorState,
  scope: SqlExecutionScope = "current",
): SqlExecutionTarget | null {
  const document = state.doc.toString();
  const documentRange = { from: 0, to: state.doc.length };

  if (scope === "all") {
    return createTarget(document, documentRange, "document");
  }

  const selection = state.selection.main;
  const selectionTarget = createTarget(
    document,
    { from: selection.from, to: selection.to },
    "selection",
  );
  if (selectionTarget) return selectionTarget;

  const cursor = selection.head;
  const statementRanges = getStatementRanges(state);
  const statementRange = statementRanges.find(
    (range, index) =>
      cursor >= range.from &&
      (cursor < range.to ||
        (index === statementRanges.length - 1 && cursor === range.to)),
  );

  if (statementRange) {
    return createTarget(document, statementRange, "statement");
  }

  return createTarget(document, documentRange, "document");
}
