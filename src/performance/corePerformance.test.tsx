import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { connectionApi } from "../features/connections/connectionApi";
import {
  databaseObjectKinds,
  groupDatabaseObjects,
  type DatabaseObject,
} from "../features/database-tree/databaseTree";
import { queryDraftApi } from "../features/drafts/queryDraftApi";
import { queryHistoryApi } from "../features/history/queryHistoryApi";
import type { QueryExecutionResult } from "../features/query-execution/queryExecution";
import { buildQueryGridRows } from "../features/query-results/queryResultRows";
import { normalizeTableDataPage } from "../features/table-data/tableData";
import { workspaceSnapshotApi } from "../features/workspace/workspaceSnapshotApi";
import { I18nProvider } from "../i18n/I18nProvider";

declare const process: {
  memoryUsage(): { heapUsed: number };
};

const megabyte = 1024 * 1024;

function usedHeap() {
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
  return process.memoryUsage().heapUsed;
}

function deltaMb(before: number, after: number) {
  return Number((Math.max(0, after - before) / megabyte).toFixed(2));
}

describe("core performance regression", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("renders the disconnected application shell within the startup budget", async () => {
    window.localStorage.setItem("plume.locale", "en-US");
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([]);
    vi.spyOn(queryDraftApi, "list").mockResolvedValue([]);
    vi.spyOn(queryHistoryApi, "list").mockResolvedValue([]);
    vi.spyOn(workspaceSnapshotApi, "load").mockResolvedValue(null);
    vi.spyOn(workspaceSnapshotApi, "save").mockImplementation(
      async (request) => ({ ...request, updatedAt: 1 }),
    );

    const heapBefore = usedHeap();
    const startedAt = performance.now();
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Connect to PostgreSQL and start working",
      }),
    ).toBeVisible();
    const shellReadyMs = performance.now() - startedAt;
    const heapDeltaMb = deltaMb(heapBefore, usedHeap());

    console.info(
      JSON.stringify({ benchmark: "app-shell", shellReadyMs, heapDeltaMb }),
    );
    expect(shellReadyMs).toBeLessThanOrEqual(2_000);
    expect(heapDeltaMb).toBeLessThanOrEqual(64);
  });

  it("groups a large schema without exceeding the object-tree budget", () => {
    const objects: DatabaseObject[] = Array.from({ length: 100_000 }, (_, index) => ({
      name: `object_${index}`,
      kind: databaseObjectKinds[index % databaseObjectKinds.length]!,
    }));
    const heapBefore = usedHeap();
    const startedAt = performance.now();
    const grouped = groupDatabaseObjects(objects);
    const groupMs = performance.now() - startedAt;
    const heapDeltaMb = deltaMb(heapBefore, usedHeap());

    console.info(
      JSON.stringify({ benchmark: "object-tree", groupMs, heapDeltaMb }),
    );
    for (const kind of databaseObjectKinds) {
      expect(grouped[kind]).toHaveLength(12_500);
    }
    expect(groupMs).toBeLessThanOrEqual(250);
    expect(heapDeltaMb).toBeLessThanOrEqual(32);
  });

  it("normalizes the table-data first page within the interaction budget", () => {
    const result: QueryExecutionResult = {
      queryId: "first-page",
      status: "succeeded",
      results: [
        {
          statementIndex: 0,
          status: "succeeded",
          kind: "rows",
          columns: [{ name: "id", ordinal: 0, dataType: { kind: "simple" } }],
          batches: [
            {
              offset: 0,
              rows: Array.from({ length: 201 }, (_, index) => [String(index + 1)]),
            },
          ],
          rowCount: 201,
          retainedRowCount: 201,
          truncated: false,
        },
      ],
    };
    const heapBefore = usedHeap();
    const startedAt = performance.now();
    let page = normalizeTableDataPage(result, 200);
    for (let index = 1; index < 1_000; index += 1) {
      page = normalizeTableDataPage(result, 200);
    }
    const normalizeMs = performance.now() - startedAt;
    const heapDeltaMb = deltaMb(heapBefore, usedHeap());

    console.info(
      JSON.stringify({ benchmark: "first-page", normalizeMs, heapDeltaMb }),
    );
    expect(page.hasNextPage).toBe(true);
    expect(page.result.results[0]?.retainedRowCount).toBe(200);
    expect(normalizeMs).toBeLessThanOrEqual(500);
    expect(heapDeltaMb).toBeLessThanOrEqual(32);
  });

  it("projects the maximum retained result without unbounded extra memory", () => {
    const columnCount = 40;
    const rowCount = 10_000;
    const result: QueryExecutionResult = {
      queryId: "large-result",
      status: "succeeded",
      results: [
        {
          statementIndex: 0,
          status: "succeeded",
          kind: "rows",
          columns: Array.from({ length: columnCount }, (_, ordinal) => ({
            name: `column_${ordinal}`,
            ordinal,
            dataType: { kind: "simple" },
          })),
          batches: Array.from({ length: 10 }, (_, batchIndex) => ({
            offset: batchIndex * 1_000,
            rows: Array.from({ length: 1_000 }, (_, rowIndex) =>
              Array.from(
                { length: columnCount },
                (_, columnIndex) => `${batchIndex * 1_000 + rowIndex}:${columnIndex}`,
              ),
            ),
          })),
          rowCount,
          retainedRowCount: rowCount,
          truncated: true,
        },
      ],
    };
    const heapBefore = usedHeap();
    const startedAt = performance.now();
    const rows = buildQueryGridRows(result.results[0]!);
    const projectionMs = performance.now() - startedAt;
    const heapDeltaMb = deltaMb(heapBefore, usedHeap());

    console.info(
      JSON.stringify({ benchmark: "large-result", projectionMs, heapDeltaMb }),
    );
    expect(rows).toHaveLength(rowCount);
    expect(rows[rowCount - 1]?.values[columnCount - 1]).toBe("9999:39");
    expect(projectionMs).toBeLessThanOrEqual(250);
    expect(heapDeltaMb).toBeLessThanOrEqual(32);
  });
});
