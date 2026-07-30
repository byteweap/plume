import type {
  QueryColumn,
  QueryValue,
} from "../query-execution/queryExecution";

export type QueryResultValueKind =
  | "null"
  | "empty"
  | "whitespace"
  | "boolean"
  | "numeric"
  | "datetime"
  | "json"
  | "array"
  | "binary"
  | "text";

export interface QueryResultValuePresentation {
  kind: QueryResultValueKind;
  rawText: string | null;
  displayText: string;
  titleText: string;
  copyText: string;
}

const nullText = "NULL";
const byteaPreviewByteLimit = 24;

const booleanTypeNames = new Set(["bool", "boolean"]);
const numericTypeNames = new Set([
  "int2",
  "int4",
  "int8",
  "smallint",
  "integer",
  "int",
  "bigint",
  "float4",
  "float8",
  "real",
  "double precision",
  "numeric",
  "decimal",
  "money",
  "oid",
  "smallserial",
  "serial",
  "bigserial",
]);
const datetimeTypeNames = new Set([
  "date",
  "time",
  "timetz",
  "time without time zone",
  "time with time zone",
  "timestamp",
  "timestamptz",
  "timestamp without time zone",
  "timestamp with time zone",
  "interval",
]);
const jsonTypeNames = new Set(["json", "jsonb"]);
const byteaTypeNames = new Set(["bytea"]);

const booleanTypeOids = new Set([16]);
const numericTypeOids = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);
const datetimeTypeOids = new Set([1082, 1083, 1114, 1184, 1266, 1186]);
const jsonTypeOids = new Set([114, 3802]);
const byteaTypeOids = new Set([17]);

function dataTypeName(column: QueryColumn | undefined): string | undefined {
  return column?.dataType.name?.trim().toLowerCase();
}

function hasDataType(
  column: QueryColumn | undefined,
  names: ReadonlySet<string>,
  oids: ReadonlySet<number>,
): boolean {
  const dataType = column?.dataType;
  if (!dataType || dataType.kind !== "simple") return false;

  const name = dataTypeName(column);
  return (
    (name !== undefined && names.has(name)) ||
    (dataType.oid !== undefined && oids.has(dataType.oid))
  );
}

function isBytea(column: QueryColumn | undefined): boolean {
  return hasDataType(column, byteaTypeNames, byteaTypeOids);
}

function formatBytea(value: string): string {
  const match = /^\\x([0-9a-fA-F]*)$/.exec(value);
  const hex = match?.[1];
  if (hex === undefined || hex.length % 2 !== 0) return value;

  const byteLength = hex.length / 2;
  const previewHexLength = Math.min(
    hex.length,
    byteaPreviewByteLimit * 2,
  );
  const isTruncated = previewHexLength < hex.length;
  const preview = `\\x${hex.slice(0, previewHexLength)}`;
  return `${preview}${isTruncated ? "..." : ""} (${byteLength} B)`;
}

function classifyTextValue(
  column: QueryColumn | undefined,
): QueryResultValueKind {
  if (column?.dataType.kind === "array") return "array";
  if (column?.dataType.kind !== "simple") return "text";
  if (isBytea(column)) return "binary";
  if (hasDataType(column, booleanTypeNames, booleanTypeOids)) {
    return "boolean";
  }
  if (hasDataType(column, numericTypeNames, numericTypeOids)) {
    return "numeric";
  }
  if (hasDataType(column, datetimeTypeNames, datetimeTypeOids)) {
    return "datetime";
  }
  if (hasDataType(column, jsonTypeNames, jsonTypeOids)) return "json";

  return "text";
}

function displayTextFor(value: string, kind: QueryResultValueKind): string {
  if (kind === "boolean") {
    if (value === "t") return "true";
    if (value === "f") return "false";
  }
  if (kind === "binary") return formatBytea(value);
  return value;
}

function whitespaceDisplayText(value: string): string {
  return JSON.stringify(value) ?? value;
}

export function presentQueryResultValue(
  value: QueryValue | undefined,
  column: QueryColumn | undefined,
): QueryResultValuePresentation {
  const rawText = value ?? null;
  if (rawText === null) {
    return {
      kind: "null",
      rawText,
      displayText: nullText,
      titleText: nullText,
      copyText: nullText,
    };
  }

  if (rawText.length === 0) {
    return {
      kind: "empty",
      rawText,
      displayText: "''",
      titleText: rawText,
      copyText: rawText,
    };
  }

  if (rawText.trim().length === 0) {
    return {
      kind: "whitespace",
      rawText,
      displayText: whitespaceDisplayText(rawText),
      titleText: rawText,
      copyText: rawText,
    };
  }

  const kind = classifyTextValue(column);
  return {
    kind,
    rawText,
    displayText: displayTextFor(rawText, kind),
    titleText: rawText,
    copyText: rawText,
  };
}
