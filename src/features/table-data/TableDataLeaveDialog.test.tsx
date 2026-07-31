import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TableDataLeaveDialog } from "./TableDataLeaveDialog";

const item = {
  id: "table-1",
  database: "analytics",
  schema: "public",
  table: "orders",
  changes: {
    insertedRows: [
      { localId: "new-1", pageIndex: 0, values: [{ kind: "default" as const }] },
    ],
    updatedRows: [],
    deletedRows: [],
  },
};

describe("TableDataLeaveDialog", () => {
  it("summarizes pending tables and exposes all three leave decisions", () => {
    const onCommit = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <TableDataLeaveDialog
          items={[item]}
          status="idle"
          onCommit={onCommit}
          onDiscard={onDiscard}
          onCancel={onCancel}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("orders");
    expect(screen.getByText("1 inserted · 0 updated · 0 deleted")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Commit and continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[1]!);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("blocks decisions while committing and reports a failed commit", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    const { rerender } = render(
      <I18nProvider>
        <TableDataLeaveDialog
          items={[item]}
          status="committing"
          onCommit={vi.fn()}
          onDiscard={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Committing transaction" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard and continue" })).toBeDisabled();

    rerender(
      <I18nProvider>
        <TableDataLeaveDialog
          items={[item]}
          status="failed"
          error="duplicate key"
          onCommit={vi.fn()}
          onDiscard={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not commit; leaving was cancelled",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("duplicate key");
  });
});
