import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { QueryStatementResult } from "../query-execution/queryExecution";
import { CsvExportDialog } from "./CsvExportDialog";
import type {
  CsvExportProgress,
  CsvExportRequest,
  CsvExportResult,
} from "./csvExport";

const apiMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("./csvExportApi", () => ({
  csvExportApi: apiMocks,
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

function renderDialog(selection?: {
  anchor: { rowIndex: number; columnIndex: number };
  focus: { rowIndex: number; columnIndex: number };
}) {
  window.localStorage.setItem("plume.locale", "en-US");
  return render(
    <I18nProvider>
      <CsvExportDialog
        statement={statement}
        selection={selection}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("CsvExportDialog", () => {
  beforeEach(() => {
    apiMocks.execute.mockReset();
    apiMocks.cancel.mockReset();
    apiMocks.cancel.mockResolvedValue({
      taskId: "task-1",
      status: "requested",
    });
  });

  it("exports the current selection with configurable CSV options", async () => {
    apiMocks.execute.mockImplementation(
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
    renderDialog({
      anchor: { rowIndex: 0, columnIndex: 1 },
      focus: { rowIndex: 1, columnIndex: 2 },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Current selection" }));
    expect(screen.getByRole("radio", { name: "Current selection" })).toBeChecked();
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

    await waitFor(() => expect(apiMocks.execute).toHaveBeenCalledTimes(1));
    expect(apiMocks.execute.mock.calls[0]![0]).toEqual(
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
    expect(screen.getByText("2 / 2 rows written")).toBeVisible();
  });

  it("requests cancellation for a running export", async () => {
    let resolveExport: ((result: CsvExportResult) => void) | undefined;
    apiMocks.execute.mockImplementation(
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

    await waitFor(() => expect(apiMocks.cancel).toHaveBeenCalledTimes(1));
    const request = apiMocks.execute.mock.calls[0]![0] as CsvExportRequest;
    expect(apiMocks.cancel).toHaveBeenCalledWith(request.taskId);
    await act(async () => {
      resolveExport?.({
        taskId: request.taskId,
        status: "cancelled",
        rowsWritten: 0,
      });
    });
    expect(await screen.findByText("CSV export cancelled")).toBeVisible();
  });
});
