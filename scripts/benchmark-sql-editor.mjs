import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";

const fixtureLines = 10_000;
const source = Array.from(
  { length: fixtureLines },
  (_, index) => `select ${index + 1} as row_number, 'plume' as source_name;`,
).join("\n");

const dom = new JSDOM('<div id="editor"></div>', {
  pretendToBeVisual: true,
});
const { window } = dom;

Object.defineProperties(globalThis, {
  window: { configurable: true, value: window },
  document: { configurable: true, value: window.document },
  navigator: { configurable: true, value: window.navigator },
  MutationObserver: { configurable: true, value: window.MutationObserver },
  DOMRect: { configurable: true, value: window.DOMRect },
  Range: { configurable: true, value: window.Range },
  getComputedStyle: { configurable: true, value: window.getComputedStyle },
  requestAnimationFrame: {
    configurable: true,
    value: window.requestAnimationFrame.bind(window),
  },
  cancelAnimationFrame: {
    configurable: true,
    value: window.cancelAnimationFrame.bind(window),
  },
  ResizeObserver: {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  },
});

const [{ basicSetup, EditorView }, { PostgreSQL, sql }] = await Promise.all([
  import("codemirror"),
  import("@codemirror/lang-sql"),
]);

globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const mountStarted = performance.now();
const view = new EditorView({
  doc: source,
  extensions: [basicSetup, sql({ dialect: PostgreSQL })],
  parent: document.querySelector("#editor"),
});
const mountMs = performance.now() - mountStarted;

const updateStarted = performance.now();
view.dispatch({
  changes: { from: 0, to: 6, insert: "SELECT" },
  selection: { anchor: 0, head: 6 },
});
const updateMs = performance.now() - updateStarted;
const selectedText = view.state.sliceDoc(
  view.state.selection.main.from,
  view.state.selection.main.to,
);
const heapAfter = process.memoryUsage().heapUsed;

const result = {
  fixtureLines,
  fixtureCharacters: source.length,
  mountMs: Number(mountMs.toFixed(2)),
  updateMs: Number(updateMs.toFixed(2)),
  heapDeltaMb: Number(
    (Math.max(0, heapAfter - heapBefore) / 1024 / 1024).toFixed(2),
  ),
  selectedText,
};

view.destroy();
window.close();

console.log(JSON.stringify(result, null, 2));

if (
  result.mountMs > 1_000 ||
  result.updateMs > 100 ||
  result.heapDeltaMb > 128 ||
  result.selectedText !== "SELECT"
) {
  throw new Error("SQL editor benchmark exceeded its decision thresholds.");
}
