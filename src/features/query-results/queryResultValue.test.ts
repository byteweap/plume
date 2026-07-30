import { describe, expect, it } from "vitest";
import type {
  QueryColumn,
  QueryDataType,
} from "../query-execution/queryExecution";
import { presentQueryResultValue } from "./queryResultValue";

function column(dataType: QueryDataType): QueryColumn {
  return { name: "value", ordinal: 0, dataType };
}

describe("query result value presentation", () => {
  it("classifies null, empty, and whitespace values before type metadata", () => {
    const booleanColumn = column({ kind: "simple", name: "bool", oid: 16 });

    expect(presentQueryResultValue(null, booleanColumn)).toEqual({
      kind: "null",
      rawText: null,
      displayText: "NULL",
      titleText: "NULL",
      copyText: "NULL",
    });
    expect(presentQueryResultValue("", booleanColumn)).toEqual({
      kind: "empty",
      rawText: "",
      displayText: "''",
      titleText: "",
      copyText: "",
    });
    expect(presentQueryResultValue(" \t\n", booleanColumn)).toEqual({
      kind: "whitespace",
      rawText: " \t\n",
      displayText: "\" \\t\\n\"",
      titleText: " \t\n",
      copyText: " \t\n",
    });
  });

  it("uses boolean metadata to display PostgreSQL t and f values", () => {
    const booleanColumn = column({ kind: "simple", name: "bool", oid: 16 });

    expect(presentQueryResultValue("t", booleanColumn)).toMatchObject({
      kind: "boolean",
      rawText: "t",
      displayText: "true",
      titleText: "t",
      copyText: "t",
    });
    expect(presentQueryResultValue("f", booleanColumn)).toMatchObject({
      kind: "boolean",
      rawText: "f",
      displayText: "false",
      titleText: "f",
      copyText: "f",
    });
  });

  it("classifies numeric and datetime values from metadata without parsing them", () => {
    const numericColumn = column({ kind: "simple", name: "numeric", oid: 1700 });
    const timestampColumn = column({
      kind: "simple",
      name: "timestamptz",
      oid: 1184,
    });

    expect(presentQueryResultValue("001.20e+03", numericColumn)).toMatchObject({
      kind: "numeric",
      displayText: "001.20e+03",
    });
    expect(
      presentQueryResultValue("not a date", timestampColumn),
    ).toMatchObject({
      kind: "datetime",
      displayText: "not a date",
    });
  });

  it("recognizes common PostgreSQL type aliases", () => {
    const integerColumn = column({ kind: "simple", name: "integer" });
    const timestampColumn = column({
      kind: "simple",
      name: "timestamp with time zone",
    });

    expect(presentQueryResultValue("01", integerColumn).kind).toBe("numeric");
    expect(presentQueryResultValue("not a date", timestampColumn).kind).toBe(
      "datetime",
    );
  });

  it("classifies JSON from metadata and preserves invalid JSON text", () => {
    const jsonColumn = column({ kind: "simple", name: "jsonb", oid: 3802 });
    const rawJson = "{not valid json}";

    expect(presentQueryResultValue(rawJson, jsonColumn)).toMatchObject({
      kind: "json",
      rawText: rawJson,
      displayText: rawJson,
      titleText: rawJson,
      copyText: rawJson,
    });
  });

  it("gives array metadata precedence over a JSON type name", () => {
    const arrayColumn = column({ kind: "array", name: "jsonb", oid: 3802 });

    expect(presentQueryResultValue("{\"one\"}", arrayColumn)).toMatchObject({
      kind: "array",
      displayText: "{\"one\"}",
    });
  });

  it("bounds standard bytea hex previews while retaining full title and copy text", () => {
    const byteaColumn = column({ kind: "simple", name: "bytea", oid: 17 });
    const rawBytea = `\\x${"ab".repeat(25)}`;

    expect(presentQueryResultValue(rawBytea, byteaColumn)).toEqual({
      kind: "binary",
      rawText: rawBytea,
      displayText: `\\x${"ab".repeat(24)}... (25 B)`,
      titleText: rawBytea,
      copyText: rawBytea,
    });
  });

  it("leaves nonstandard bytea text unformatted", () => {
    const byteaColumn = column({ kind: "simple", name: "bytea", oid: 17 });

    expect(presentQueryResultValue("\\x0", byteaColumn)).toMatchObject({
      kind: "binary",
      displayText: "\\x0",
    });
  });

  it("falls back to text for unknown and unrecognized data types", () => {
    const unknownJsonColumn = column({
      kind: "unknown",
      name: "jsonb",
      oid: 3802,
    });
    const uuidColumn = column({ kind: "simple", name: "uuid", oid: 2950 });

    expect(presentQueryResultValue("{\"one\":1}", unknownJsonColumn)).toMatchObject({
      kind: "text",
      displayText: "{\"one\":1}",
    });
    expect(presentQueryResultValue("123", uuidColumn)).toMatchObject({
      kind: "text",
      displayText: "123",
    });
  });
});
