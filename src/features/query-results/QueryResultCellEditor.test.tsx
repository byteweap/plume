import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { QueryResultCellEditor } from "./QueryResultCellEditor";

const textColumn = {
  name: "display_name",
  ordinal: 0,
  dataType: { kind: "simple" as const, name: "text", oid: 25 },
};

function renderEditor(
  originalValue: string | null,
  pendingValue?:
    | { kind: "value"; value: string }
    | { kind: "null" }
    | { kind: "default" },
) {
  window.localStorage.setItem("plume.locale", "en-US");
  const onCommit = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <QueryResultCellEditor
        column={textColumn}
        originalValue={originalValue}
        pendingValue={pendingValue}
        onCommit={onCommit}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onCommit, onClose };
}

describe("QueryResultCellEditor", () => {
  it("keeps an empty string distinct from NULL", () => {
    const { onCommit } = renderEditor(null);
    fireEvent.change(screen.getByRole("combobox", { name: "Value mode" }), {
      target: { value: "value" },
    });
    const input = screen.getByRole("textbox", { name: "Edit display_name" });
    expect(input).toHaveValue("");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith({ kind: "value", value: "" });
  });

  it("commits an explicit NULL mode", () => {
    const { onCommit } = renderEditor("old");
    fireEvent.change(screen.getByRole("combobox", { name: "Value mode" }), {
      target: { value: "null" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply cell value" }));
    expect(onCommit).toHaveBeenCalledWith({ kind: "null" });
  });

  it("commits an explicit DEFAULT mode", () => {
    const { onCommit } = renderEditor("old", { kind: "default" });
    fireEvent.click(screen.getByRole("button", { name: "Apply cell value" }));
    expect(onCommit).toHaveBeenCalledWith({ kind: "default" });
  });

  it("preserves raw PostgreSQL text without JavaScript coercion", () => {
    const { onCommit } = renderEditor("1.0");
    const input = screen.getByRole("textbox", { name: "Edit display_name" });
    fireEvent.change(input, { target: { value: "001.20e+03" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      kind: "value",
      value: "001.20e+03",
    });
  });

  it("closes without staging when cancelled", () => {
    const { onCommit, onClose } = renderEditor("old", { kind: "default" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel cell edit" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
