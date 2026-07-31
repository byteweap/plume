import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { QueryExecutionResult } from "../query-execution/queryExecution";
import { QueryResultPanel } from "./QueryResultPanel";

const result: QueryExecutionResult = {
  queryId: "query-1",
  status: "succeeded",
  results: [
    {
      statementIndex: 0,
      status: "succeeded",
      kind: "rows",
      columns: [
        {
          name: "name",
          ordinal: 0,
          dataType: { kind: "simple", oid: 25, name: "text" },
        },
        {
          name: "detail",
          ordinal: 1,
          dataType: { kind: "simple", oid: 25, name: "text" },
        },
      ],
      batches: [
        {
          offset: 0,
          rows: [
            ["one", null],
            ["two", "value"],
            ["three", "last"],
          ],
        },
      ],
      rowCount: 3,
      retainedRowCount: 3,
      truncated: false,
    },
    {
      statementIndex: 1,
      status: "succeeded",
      kind: "command",
      columns: [],
      batches: [],
      rowCount: 0,
      retainedRowCount: 0,
      affectedRows: 4,
      truncated: false,
    },
  ],
};

const typedResult: QueryExecutionResult = {
  queryId: "typed-query",
  status: "succeeded",
  results: [
    {
      statementIndex: 0,
      status: "succeeded",
      kind: "rows",
      columns: [
        {
          name: "published",
          ordinal: 0,
          dataType: { kind: "simple", oid: 16, name: "bool" },
        },
      ],
      batches: [
        {
          offset: 0,
          rows: [["t"]],
        },
      ],
      rowCount: 1,
      retainedRowCount: 1,
      truncated: false,
    },
  ],
};

const invisibleValuesResult: QueryExecutionResult = {
  queryId: "invisible-values-query",
  status: "succeeded",
  results: [
    {
      statementIndex: 0,
      status: "succeeded",
      kind: "rows",
      columns: [
        {
          name: "value",
          ordinal: 0,
          dataType: { kind: "simple", oid: 25, name: "text" },
        },
      ],
      batches: [
        { offset: 0, rows: [[null], [""], [" \t"]] },
      ],
      rowCount: 3,
      retainedRowCount: 3,
      truncated: false,
    },
  ],
};

const truncatedResult: QueryExecutionResult = {
  queryId: "truncated-query",
  status: "succeeded",
  results: [
    {
      statementIndex: 0,
      status: "succeeded",
      kind: "rows",
      columns: [],
      batches: [],
      rowCount: 5,
      retainedRowCount: 2,
      truncated: true,
    },
  ],
};

function renderPanel() {
  window.localStorage.setItem("plume.locale", "en-US");
  return render(
    <I18nProvider>
      <QueryResultPanel result={result} />
    </I18nProvider>,
  );
}

function renderTypedPanel() {
  window.localStorage.setItem("plume.locale", "en-US");
  return render(
    <I18nProvider>
      <QueryResultPanel result={typedResult} />
    </I18nProvider>,
  );
}

function renderInvisibleValuesPanel() {
  window.localStorage.setItem("plume.locale", "en-US");
  return render(
    <I18nProvider>
      <QueryResultPanel result={invisibleValuesResult} />
    </I18nProvider>,
  );
}

describe("QueryResultPanel", () => {
  it("selects a requested result cell and acknowledges the target", async () => {
    const onFocusTargetApplied = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <QueryResultPanel
          result={result}
          focusTarget={{ requestId: 7, rowIndex: 2, columnIndex: 1 }}
          onFocusTargetApplied={onFocusTargetApplied}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(onFocusTargetApplied).toHaveBeenCalledWith(7));
    expect(screen.getByText("last").closest("[role='gridcell']")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders row results and switches between statement tabs", () => {
    renderPanel();

    expect(screen.getByRole("grid", { name: "Result 1" })).toBeVisible();
    expect(screen.getByText("3 / 3 rows")).toBeVisible();
    const commandTab = screen.getByRole("tab", { name: "Result 2" });
    fireEvent.click(commandTab);

    expect(screen.getByText("Statement completed")).toBeVisible();
    expect(screen.getByText("Rows affected 4")).toBeVisible();
  });

  it("opens the cell editor only when table editing is enabled", () => {
    const onCellValueChange = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    const { unmount } = render(
      <I18nProvider>
        <QueryResultPanel
          result={result}
          editing={{
            insertedRows: [],
            getPendingValue: () => undefined,
            onCellValueChange,
            isRowDeleted: () => false,
            onDiscardInsertedRow: vi.fn(),
            onToggleRowDeleted: vi.fn(),
          }}
        />
      </I18nProvider>,
    );
    const cell = screen.getByText("one").closest("[role='gridcell']");
    expect(cell).not.toBeNull();
    fireEvent.doubleClick(cell!);
    const input = screen.getByRole("textbox", { name: "Edit name" });
    fireEvent.change(input, { target: { value: "updated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCellValueChange).toHaveBeenCalledWith(
      { rowIndex: 0, values: ["one", null] },
      0,
      { kind: "value", value: "updated" },
    );

    unmount();
    renderPanel();
    fireEvent.doubleClick(screen.getByText("one").closest("[role='gridcell']")!);
    expect(screen.queryByRole("textbox", { name: "Edit name" })).toBeNull();
  });

  it("shows staged values with their original value and pending state", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <QueryResultPanel
          result={result}
          editing={{
            insertedRows: [],
            getPendingValue: (row, columnIndex) =>
              row.rowIndex === 0 && columnIndex === 0
                ? { kind: "default" }
                : undefined,
            onCellValueChange: vi.fn(),
            isRowDeleted: () => false,
            onDiscardInsertedRow: vi.fn(),
            onToggleRowDeleted: vi.fn(),
          }}
        />
      </I18nProvider>,
    );
    const staged = screen.getByText("DEFAULT");
    expect(staged).toHaveAttribute(
      "title",
      "Original: one\nStaged: DEFAULT",
    );
    expect(staged.closest("[role='gridcell']")).toHaveClass(
      "query-result-cell-pending",
    );
  });

  it("renders and edits a local inserted row with DEFAULT values", () => {
    const emptyResult: QueryExecutionResult = {
      queryId: "empty-query",
      status: "succeeded",
      results: [
        {
          ...result.results[0]!,
          batches: [],
          rowCount: 0,
          retainedRowCount: 0,
        },
      ],
    };
    const insertedRows = [
      {
        localId: "local-1",
        pageIndex: 0,
        values: [{ kind: "default" as const }, { kind: "default" as const }],
      },
    ];
    const onCellValueChange = vi.fn();
    const onDiscardInsertedRow = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <QueryResultPanel
          result={emptyResult}
          editing={{
            insertedRows,
            getPendingValue: (row, columnIndex) =>
              row.insertedId
                ? insertedRows[0]?.values[columnIndex]
                : undefined,
            onCellValueChange,
            isRowDeleted: () => false,
            onDiscardInsertedRow,
            onToggleRowDeleted: vi.fn(),
          }}
        />
      </I18nProvider>,
    );

    const defaults = screen.getAllByText("DEFAULT");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toHaveAttribute("title", "Staged: DEFAULT");
    fireEvent.doubleClick(defaults[0]!.closest("[role='gridcell']")!);
    fireEvent.change(screen.getByRole("combobox", { name: "Value mode" }), {
      target: { value: "null" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply cell value" }));
    expect(onCellValueChange).toHaveBeenCalledWith(
      expect.objectContaining({ insertedId: "local-1" }),
      0,
      { kind: "null" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard new row" }));
    expect(onDiscardInsertedRow).toHaveBeenCalledWith("local-1");
  });

  it("marks existing rows as deleted and offers restoration", () => {
    const onToggleRowDeleted = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    const { unmount } = render(
      <I18nProvider>
        <QueryResultPanel
          result={result}
          editing={{
            insertedRows: [],
            getPendingValue: () => undefined,
            onCellValueChange: vi.fn(),
            isRowDeleted: () => false,
            onDiscardInsertedRow: vi.fn(),
            onToggleRowDeleted,
          }}
        />
      </I18nProvider>,
    );
    const deleteButtons = screen.getAllByRole("button", {
      name: "Mark row for deletion",
    });
    fireEvent.click(deleteButtons[0]!);
    expect(onToggleRowDeleted).toHaveBeenCalledWith({
      rowIndex: 0,
      values: ["one", null],
    });

    unmount();
    render(
      <I18nProvider>
        <QueryResultPanel
          result={result}
          editing={{
            insertedRows: [],
            getPendingValue: () => undefined,
            onCellValueChange: vi.fn(),
            isRowDeleted: (row) => row.rowIndex === 0,
            onDiscardInsertedRow: vi.fn(),
            onToggleRowDeleted,
          }}
        />
      </I18nProvider>,
    );
    const deletedCell = screen.getByText("one").closest("[role='gridcell']");
    expect(deletedCell).toHaveClass("query-result-cell-deleted");
    fireEvent.doubleClick(deletedCell!);
    expect(screen.queryByRole("textbox", { name: "Edit name" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore deleted row" }),
    );
    expect(onToggleRowDeleted).toHaveBeenLastCalledWith({
      rowIndex: 0,
      values: ["one", null],
    });
  });

  it("supports keyboard navigation between statement tabs", () => {
    renderPanel();

    const firstTab = screen.getByRole("tab", { name: "Result 1" });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });

    const secondTab = screen.getByRole("tab", { name: "Result 2" });
    expect(secondTab).toHaveFocus();
    expect(secondTab).toHaveAttribute("aria-selected", "true");
  });

  it("copies a shift-selected rectangular range as TSV", () => {
    renderPanel();

    const firstCell = screen.getByText("one").closest("[role='gridcell']");
    const lastCell = screen.getByText("three").closest("[role='gridcell']");
    expect(firstCell).not.toBeNull();
    expect(lastCell).not.toBeNull();

    fireEvent.mouseDown(firstCell!);
    fireEvent.mouseDown(lastCell!, { shiftKey: true });

    const setData = vi.fn();
    fireEvent.copy(screen.getByRole("grid"), {
      clipboardData: { setData },
    });
    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "one\ntwo\nthree",
    );
  });

  it("extends the copied range with Shift and arrow keys", () => {
    renderPanel();

    const firstCell = screen.getByText("one").closest("[role='gridcell']");
    expect(firstCell).not.toBeNull();
    fireEvent.mouseDown(firstCell!);
    fireEvent.keyDown(firstCell!, { key: "ArrowDown", shiftKey: true });

    const setData = vi.fn();
    fireEvent.copy(screen.getByRole("grid"), {
      clipboardData: { setData },
    });
    expect(setData).toHaveBeenCalledWith("text/plain", "one\ntwo");
  });

  it("copies complete rows selected through the row numbers", () => {
    renderPanel();

    const rowNumbers = screen.getAllByTitle("Select row");
    fireEvent.mouseDown(rowNumbers[1]!.closest("[role='gridcell']")!);
    fireEvent.mouseDown(rowNumbers[2]!.closest("[role='gridcell']")!, {
      shiftKey: true,
    });

    const setData = vi.fn();
    fireEvent.copy(screen.getByRole("grid"), {
      clipboardData: { setData },
    });
    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      "two\tvalue\nthree\tlast",
    );
  });

  it("copies selected rows with their column names", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPanel();

    const rowNumbers = screen.getAllByTitle("Select row");
    fireEvent.mouseDown(rowNumbers[0]!.closest("[role='gridcell']")!);
    fireEvent.mouseDown(rowNumbers[2]!.closest("[role='gridcell']")!, {
      shiftKey: true,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy selection with column names",
      }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "name\tdetail\none\tNULL\ntwo\tvalue\nthree\tlast",
      ),
    );
    expect(screen.getByText("Copied selected results")).toBeVisible();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("opens CSV export configuration for retained results", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(screen.getByRole("dialog", { name: "Export CSV" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "All fetched results" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Encoding" })).toHaveValue(
      "utf-8-bom",
    );
  });

  it("opens JSON export configuration for retained results", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(screen.getByRole("dialog", { name: "Export JSON" })).toBeVisible();
  });

  it("renders booleans without changing their clipboard values", () => {
    renderTypedPanel();

    const booleanValue = screen.getByText("true");
    expect(booleanValue).toHaveClass("query-result-value-boolean");
    expect(screen.getByText("bool")).toBeVisible();

    const booleanCell = booleanValue.closest("[role='gridcell']");
    expect(booleanCell).not.toBeNull();
    fireEvent.mouseDown(booleanCell!);

    const setData = vi.fn();
    fireEvent.copy(screen.getByRole("grid"), {
      clipboardData: { setData },
    });
    expect(setData).toHaveBeenCalledWith("text/plain", "t");
  });

  it("makes null, empty, and whitespace-only text visible", () => {
    renderInvisibleValuesPanel();

    expect(screen.getByText("NULL")).toHaveClass("query-result-value-null");
    expect(screen.getByText("''")).toHaveClass("query-result-value-empty");
    expect(
      document.querySelector(".query-result-value-whitespace"),
    ).toHaveTextContent('" \\t"');
  });

  it("makes a reached result limit explicit", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <QueryResultPanel result={truncatedResult} />
      </I18nProvider>,
    );

    expect(screen.getByText("2 / 5 rows")).toBeVisible();
    expect(screen.getByText("Result row limit reached")).toBeVisible();
  });
});
