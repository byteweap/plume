import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { DataGrid } from "react-data-grid";

const rowCount = 10_000;
const columnCount = 40;
const rowHeight = 28;
const columns = Array.from({ length: columnCount }, (_, columnIndex) => ({
  key: `column${columnIndex}`,
  name: `Column ${columnIndex + 1}`,
  width: 120,
  resizable: true,
}));
const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
  Object.fromEntries(
    columns.map((column, columnIndex) => [
      column.key,
      `${rowIndex}:${columnIndex}`,
    ]),
  ),
);

const dom = new JSDOM('<div id="grid"></div>', {
  pretendToBeVisual: true,
});
const { window } = dom;
const viewportWidth = 1_000;
const viewportHeight = 600;

Object.defineProperties(window.HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => viewportWidth },
  clientHeight: { configurable: true, get: () => viewportHeight },
  offsetWidth: { configurable: true, get: () => viewportWidth },
  offsetHeight: { configurable: true, get: () => viewportHeight },
});
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  x: 0,
  y: 0,
  top: 0,
  right: viewportWidth,
  bottom: viewportHeight,
  left: 0,
  width: viewportWidth,
  height: viewportHeight,
  toJSON() {},
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  window: { configurable: true, value: window },
  document: { configurable: true, value: window.document },
  navigator: { configurable: true, value: window.navigator },
  Element: { configurable: true, value: window.Element },
  HTMLElement: { configurable: true, value: window.HTMLElement },
  Node: { configurable: true, value: window.Node },
  DOMRect: { configurable: true, value: window.DOMRect },
  MutationObserver: { configurable: true, value: window.MutationObserver },
  ResizeObserver: { configurable: true, value: ResizeObserverMock },
  getComputedStyle: {
    configurable: true,
    value: window.getComputedStyle.bind(window),
  },
  requestAnimationFrame: {
    configurable: true,
    value: window.requestAnimationFrame.bind(window),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: window.cancelAnimationFrame.bind(window),
  },
});
Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const root = createRoot(document.querySelector("#grid"));
const mountStarted = performance.now();
await act(async () => {
  root.render(
    React.createElement(DataGrid, {
      "aria-label": "Data grid benchmark",
      columns,
      rows,
      rowHeight,
      headerRowHeight: 30,
      rowKeyGetter: (row) => row.column0,
    }),
  );
});
const mountMs = performance.now() - mountStarted;

const grid = document.querySelector('[role="grid"]');
const renderedRowsAtStart = grid.querySelectorAll(".rdg-row").length;
const renderedCellsAtStart = grid.querySelectorAll(".rdg-cell").length;
const scrollStarted = performance.now();
await act(async () => {
  grid.scrollTop = rowCount * rowHeight;
  grid.dispatchEvent(new window.Event("scroll", { bubbles: true }));
});
const scrollMs = performance.now() - scrollStarted;
const renderedRowsAtEnd = grid.querySelectorAll(".rdg-row").length;
const renderedCellsAtEnd = grid.querySelectorAll(".rdg-cell").length;
const reachedLastRow = grid.textContent.includes(`${rowCount - 1}:0`);
const hasResizableColumns =
  grid.querySelectorAll(".rdg-cell-resizable").length > 0;
const heapAfter = process.memoryUsage().heapUsed;

const result = {
  rowCount,
  columnCount,
  mountMs: Number(mountMs.toFixed(2)),
  scrollMs: Number(scrollMs.toFixed(2)),
  heapDeltaMb: Number(
    (Math.max(0, heapAfter - heapBefore) / 1024 / 1024).toFixed(2),
  ),
  renderedRowsAtStart,
  renderedRowsAtEnd,
  renderedCellsAtStart,
  renderedCellsAtEnd,
  reachedLastRow,
  hasResizableColumns,
};

await act(async () => root.unmount());
window.close();

console.log(JSON.stringify(result, null, 2));

if (
  result.mountMs > 1_000 ||
  result.scrollMs > 100 ||
  result.heapDeltaMb > 128 ||
  result.renderedRowsAtStart > 40 ||
  result.renderedRowsAtEnd > 40 ||
  result.renderedCellsAtStart > 600 ||
  result.renderedCellsAtEnd > 600 ||
  !result.reachedLastRow ||
  !result.hasResizableColumns
) {
  throw new Error("Data grid benchmark exceeded its decision thresholds.");
}
