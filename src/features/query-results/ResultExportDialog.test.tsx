import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import {
  ResultExportDialog,
  type ResultExportFormat,
} from "./ResultExportDialog";
import type {
  CsvExportProgress,
  CsvExportRequest,
  CsvExportResult,
} from "./csvExport";
import type {
  JsonExportProgress,
  JsonExportRequest,
  JsonExportResult,
} from "./jsonExport";

const csvApiMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  cancel: vi.fn(),
}));
const jsonApiMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("./csvExportApi", () => ({
  csvExportApi: csvApiMocks,
}));
vi.mock("./jsonExportApi", () => ({
  jsonExportApi: jsonApiMocks,
}));

const statement: QueryStatementResult = {
  statementIndex: 1,
  status: "succeeded",
  kind: "rows",
  columns: [
    { name: "id", ordinal: 0, dataType: { kind: "simple" } },
    { name: "name", ordinal: 1, dataType: { kind: "simple" } },
    { name: "active", ordinal: 2, dataType: { kind: "simple" } },
  ],
  batches: [
    {
      offset: 0,
      rows: [
        ["1", "Ada", "t"],
        ["2", null, "f"],
      ],
    },
  ],
  rowCount: 2,
  retainedRowCount: 2,
  truncated: false,
};

function renderDialog(
  selection?: {
    anchor: { rowIndex: number; columnIndex: number };
    focus: { rowIndex: number; columnIndex: number };
  },
  format: ResultExportFormat = "csv",
) {
  window.localStorage.setItem("plume.locale", "en-US");
  return render(
    <I18nProvider>
      <ResultExportDialog
        format={format}
        statement={statement}
        selection={selection}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("ResultExportDialog", () => {
  beforeEach(() => {
    csvApiMocks.execute.mockReset();
    csvApiMocks.cancel.mockReset();
    jsonApiMocks.execute.mockReset();
    jsonApiMocks.cancel.mockReset();
    csvApiMocks.cancel.mockResolvedValue({
      taskId: "task-1",
      status: "requested",
    });
    jsonApiMocks.cancel.mockResolvedValue({
      taskId: "task-1",
      status: "requested",
    });
  });

  it("AC-08 exports the current selection with configurable CSV options", async () => {
    csvApiMocks.execute.mockImplementation(
      async (
        request: CsvExportRequest,
        onProgress: (progress: CsvExportProgress) => void,
      ): Promise<CsvExportResult> => {
        onProgress({
          taskId: request.taskId,
          completedRows: request.rows.length,
          totalRows: request.rows.length,
        });
        return {
          taskId: request.taskId,
          status: "completed",
          rowsWritten: request.rows.length,
        };
      },
    );
    renderDialog(
      {
        anchor: { rowIndex: 0, columnIndex: 1 },
        focus: { rowIndex: 1, columnIndex: 2 },
      },
      "csv",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Current selection" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Delimiter" }), {
      target: { value: "semicolon" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Encoding" }), {
      target: { value: "utf-16le" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include column names" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(csvApiMocks.execute).toHaveBeenCalledTimes(1));
    expect(csvApiMocks.execute.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        suggestedFileName: "query-result-2.csv",
        columns: ["name", "active"],
        rows: [
          ["Ada", "t"],
          [null, "f"],
        ],
        includeHeaders: false,
        delimiter: "semicolon",
        encoding: "utf-16le",
      }),
    );
    expect(await screen.findByText("CSV export completed")).toBeVisible();
  });

  it("AC-08 requests cancellation for a running CSV export", async () => {
    let resolveExport: ((result: CsvExportResult) => void) | undefined;
    csvApiMocks.execute.mockImplementation(
      (
        request: CsvExportRequest,
        onProgress: (progress: CsvExportProgress) => void,
      ) => {
        onProgress({
          taskId: request.taskId,
          completedRows: 0,
          totalRows: request.rows.length,
        });
        return new Promise<CsvExportResult>((resolve) => {
          resolveExport = resolve;
        });
      },
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("Exporting CSV")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));

    await waitFor(() => expect(csvApiMocks.cancel).toHaveBeenCalledTimes(1));
    const request = csvApiMocks.execute.mock.calls[0]![0] as CsvExportRequest;
    expect(csvApiMocks.cancel).toHaveBeenCalledWith(request.taskId);
    await act(async () => {
      resolveExport?.({
        taskId: request.taskId,
        status: "cancelled",
        rowsWritten: 0,
      });
    });
    expect(await screen.findByText("CSV export cancelled")).toBeVisible();
  });

  it("exports all fetched results as JSON", async () => {
    jsonApiMocks.execute.mockImplementation(
      async (
        request: JsonExportRequest,
        onProgress: (progress: JsonExportProgress) => void,
      ): Promise<JsonExportResult> => {
        onProgress({
          taskId: request.taskId,
          completedRows: request.rows.length,
          totalRows: request.rows.length,
        });
        return {
          taskId: request.taskId,
          status: "completed",
          rowsWritten: request.rows.length,
        };
      },
    );
    renderDialog(undefined, "json");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(jsonApiMocks.execute).toHaveBeenCalledTimes(1));
    expect(jsonApiMocks.execute.mock.calls[0]![0]).toEqual({
      taskId: expect.any(String),
      suggestedFileName: "query-result-2.json",
      columns: ["id", "name", "active"],
      rows: [
        ["1", "Ada", "t"],
        ["2", null, "f"],
      ],
    });
    expect(await screen.findByText("JSON export completed")).toBeVisible();
    expect(screen.getByText("2 / 2 rows written")).toBeVisible();
  });
});
