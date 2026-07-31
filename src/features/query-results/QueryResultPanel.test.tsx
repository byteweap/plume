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
  it("renders row results and switches between statement tabs", () => {
    renderPanel();

    expect(screen.getByRole("grid", { name: "Result 1" })).toBeVisible();
    expect(screen.getByText("3 / 3 rows")).toBeVisible();
    const commandTab = screen.getByRole("tab", { name: "Result 2" });
    fireEvent.click(commandTab);

    expect(screen.getByText("Statement completed")).toBeVisible();
    expect(screen.getByText("Rows affected 4")).toBeVisible();
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
