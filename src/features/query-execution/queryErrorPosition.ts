import type { SqlExecutionTarget } from "../sql-editor/SqlEditor";

export interface QueryErrorRange {
  from: number;
  to: number;
}

export function resolveQueryErrorRange(
  document: string,
  target: SqlExecutionTarget,
  position: number,
): QueryErrorRange | null {
  if (!Number.isInteger(position) || position < 1) return null;
  if (document.slice(target.from, target.to) !== target.sql) return null;

  const characters = Array.from(target.sql);
  const characterIndex = position - 1;
  if (characterIndex > characters.length) return null;

  const relativeFrom = characters
    .slice(0, characterIndex)
    .reduce((length, character) => length + character.length, 0);
  const from = target.from + relativeFrom;
  const character = characters[characterIndex];
  return {
    from,
    to: character ? from + character.length : from,
  };
}
