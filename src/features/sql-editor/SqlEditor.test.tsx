import {
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "codemirror";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SqlEditor, type SqlEditorController } from "./SqlEditor";
import { sqlCompletionApi, sqlCompletionCatalogCache } from "./sqlCompletionApi";

describe("SqlEditor", () => {
  it("exposes string-based value and selection operations", () => {
    const onChange = vi.fn();
    const controller = createRef<SqlEditorController>();
    const { rerender } = render(
      <SqlEditor
        ref={controller}
        label="SQL query workspace"
        value="select 1;"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: "SQL query workspace" })).toBeVisible();
    expect(controller.current?.getValue()).toBe("select 1;");
    expect(controller.current?.getExecutionTarget("all")).toEqual({
      sql: "select 1;",
      from: 0,
      to: 9,
      source: "document",
    });

    act(() => controller.current?.replaceSelection("explain "));
    expect(onChange).toHaveBeenLastCalledWith("explain select 1;");

    rerender(
      <SqlEditor
        ref={controller}
        label="SQL editor"
        value="select now();"
        onChange={onChange}
      />,
    );
    expect(controller.current?.getValue()).toBe("select now();");
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toBeVisible();
    expect(onChange).toHaveBeenCalledTimes(1);

    const view = EditorView.findFromDOM(
      screen.getByRole("textbox", { name: "SQL editor" }),
    );
    act(() => controller.current?.revealError({ from: 7, to: 10 }));
    expect(view?.state.selection.main).toMatchObject({ from: 7, to: 10 });
  });

  it("offers asynchronous PostgreSQL relation and column completions", async () => {
    sqlCompletionCatalogCache.clear();
    const getCatalog = vi.spyOn(sqlCompletionApi, "getCatalog").mockResolvedValue({
      schemas: [
        {
          name: "public",
          relations: [
            {
              name: "items",
              kind: "table",
              columns: ["id", "display_name"],
            },
          ],
        },
      ],
    });
    render(
      <SqlEditor
        label="SQL query workspace"
        value="SELECT i. FROM public.items i"
        completionConnection={{
          sessionId: "session-1",
          database: "postgres",
          defaultSchema: "public",
        }}
        onChange={vi.fn()}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "SQL query workspace" });
    const view = EditorView.findFromDOM(editor)!;
    const cursor = "SELECT i.".length;

    act(() => {
      view.dispatch({ selection: { anchor: cursor } });
      startCompletion(view);
    });

    await waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    const labels = currentCompletions(view.state).map((item) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["id", "display_name"]));
    expect(labels).not.toContain("now");
    expect(getCatalog).toHaveBeenCalledWith({
      sessionId: "session-1",
      database: "postgres",
      defaultSchema: "public",
    });
    getCatalog.mockRestore();
  });

  it("offers local PostgreSQL keywords and common functions while offline", async () => {
    render(
      <SqlEditor
        label="SQL query workspace"
        value="sel"
        onChange={vi.fn()}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "SQL query workspace" });
    const view = EditorView.findFromDOM(editor)!;

    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
    });

    await waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    const labels = currentCompletions(view.state).map((item) => item.label);
    expect(labels).toContain("select");

    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "cou" },
        selection: { anchor: 3 },
      });
      startCompletion(view);
    });
    await waitFor(() =>
      expect(currentCompletions(view.state).map((item) => item.label)).toContain(
        "count",
      ),
    );
  });
});
