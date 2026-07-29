import { PostgreSQL, sql } from "@codemirror/lang-sql";
import {
  EditorSelection,
  EditorState,
  type SelectionRange,
} from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { resolveSqlExecutionTarget } from "./sqlExecutionTarget";

function createState(
  doc: string,
  selection: SelectionRange = EditorSelection.cursor(0),
) {
  return EditorState.create({
    doc,
    selection: EditorSelection.create([selection]),
    extensions: [sql({ dialect: PostgreSQL })],
  });
}

describe("resolveSqlExecutionTarget", () => {
  it("prefers a non-whitespace selection over the cursor statement", () => {
    const doc = "select 1;\nselect 2;";
    const from = doc.indexOf("select 2");
    const state = createState(
      doc,
      EditorSelection.range(from, doc.length),
    );

    expect(resolveSqlExecutionTarget(state)).toEqual({
      sql: "select 2;",
      from,
      to: doc.length,
      source: "selection",
    });
  });

  it("falls back to the cursor statement for a whitespace-only selection", () => {
    const doc = "select 1;\n  select 2;";
    const from = doc.indexOf("\n");
    const to = doc.indexOf("select 2");
    const state = createState(doc, EditorSelection.range(from, to));

    expect(resolveSqlExecutionTarget(state)).toEqual({
      sql: "select 2;",
      from: to,
      to: doc.length,
      source: "statement",
    });
  });

  it("returns the trimmed document for the explicit all scope", () => {
    const doc = "  select 1;\nselect 2;  ";
    const state = createState(doc, EditorSelection.range(2, 11));

    expect(resolveSqlExecutionTarget(state, "all")).toEqual({
      sql: "select 1;\nselect 2;",
      from: 2,
      to: doc.length - 2,
      source: "document",
    });
  });

  it.each([
    ["first", 2, "select 1;", 0, 9],
    ["second", 12, "select 2;", 10, 19],
  ])(
    "resolves the %s statement from the cursor",
    (_label, cursor, sqlText, from, to) => {
      const state = createState(
        "select 1;\nselect 2;",
        EditorSelection.cursor(cursor as number),
      );

      expect(resolveSqlExecutionTarget(state)).toEqual({
        sql: sqlText,
        from,
        to,
        source: "statement",
      });
    },
  );

  it("attaches leading and inter-statement comments to the following statement", () => {
    const doc =
      "-- heading\nselect 1;\n\n/* next */\n-- detail\nselect 2;\n-- trailing";
    const first = resolveSqlExecutionTarget(
      createState(doc, EditorSelection.cursor(doc.indexOf("select 1"))),
    );
    const secondFrom = doc.indexOf("/* next */");
    const second = resolveSqlExecutionTarget(
      createState(doc, EditorSelection.cursor(doc.indexOf("-- detail"))),
    );

    expect(first).toEqual({
      sql: "-- heading\nselect 1;",
      from: 0,
      to: doc.indexOf("select 1;") + "select 1;".length,
      source: "statement",
    });
    expect(second).toEqual({
      sql: "/* next */\n-- detail\nselect 2;\n-- trailing",
      from: secondFrom,
      to: doc.length,
      source: "statement",
    });
  });

  it("does not split on semicolons inside quoted strings", () => {
    const doc = "select 'one;two';\nselect 2;";
    const target = resolveSqlExecutionTarget(
      createState(doc, EditorSelection.cursor(doc.indexOf("two"))),
    );

    expect(target?.sql).toBe("select 'one;two';");
  });

  it("keeps a dollar-quoted PostgreSQL function body together", () => {
    const doc = `create function f() returns void language plpgsql as $$
begin
  perform 1;
  perform 2;
end
$$;
select 3;`;
    const target = resolveSqlExecutionTarget(
      createState(doc, EditorSelection.cursor(doc.indexOf("perform 2"))),
    );

    expect(target).toEqual({
      sql: doc.slice(0, doc.indexOf("\nselect 3;")),
      from: 0,
      to: doc.indexOf("\nselect 3;"),
      source: "statement",
    });
  });

  it("returns a stable target for incomplete SQL", () => {
    const doc = "select * from users where (";

    expect(
      resolveSqlExecutionTarget(
        createState(doc, EditorSelection.cursor(doc.length)),
      ),
    ).toEqual({ sql: doc, from: 0, to: doc.length, source: "statement" });
  });

  it("preserves CodeMirror UTF-16 offsets when Unicode precedes the cursor", () => {
    const doc = "select '\ud83d\ude80';\nselect '\u4e2d\u6587';";
    const from = doc.indexOf("select '\u4e2d\u6587'");
    const target = resolveSqlExecutionTarget(
      createState(doc, EditorSelection.cursor(from + 9)),
    );

    expect(target).toEqual({
      sql: "select '\u4e2d\u6587';",
      from,
      to: doc.length,
      source: "statement",
    });
  });

  it.each(["", " \n\t "])("returns null for an empty SQL document", (doc) => {
    expect(resolveSqlExecutionTarget(createState(doc))).toBeNull();
    expect(resolveSqlExecutionTarget(createState(doc), "all")).toBeNull();
  });
});
