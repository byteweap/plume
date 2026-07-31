import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TableDataChangePreview } from "./TableDataChangePreview";
import type { TableDataChangeSet } from "./tableDataChanges";

const columns = [
  {
    name: "id",
    ordinal: 0,
    dataType: { kind: "simple" as const, oid: 23, name: "int4" },
  },
  {
    name: "note",
    ordinal: 1,
    dataType: { kind: "simple" as const, oid: 25, name: "text" },
  },
];

const changes: TableDataChangeSet = {
  insertedRows: [
    {
      localId: "local-1",
      pageIndex: 2,
      values: [{ kind: "default" }, { kind: "null" }],
    },
  ],
  updatedRows: [
    {
      rowId: "row-1",
      pageIndex: 1,
      rowIndex: 4,
      locator: {
        keyName: "items_pkey",
        columns: [{ columnName: "id", value: "42" }],
      },
      cells: [
        {
          columnIndex: 1,
          columnName: "note",
          originalValue: "before",
          newValue: { kind: "value", value: "after" },
        },
      ],
    },
  ],
  deletedRows: [
    {
      rowId: "row-2",
      pageIndex: 3,
      rowIndex: 7,
      locator: {
        keyName: "items_pkey",
        columns: [{ columnName: "id", value: "99" }],
      },
      originalValues: ["99", "removed"],
    },
  ],
};

describe("TableDataChangePreview", () => {
  it("summarizes inserted, updated, and deleted values without conflating modes", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <TableDataChangePreview
          changes={changes}
          columns={columns}
          onNavigate={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Review changes")).toBeVisible();
    expect(screen.getByText("3 changed rows, 1 edited cells")).toBeVisible();
    expect(screen.getByText("id=DEFAULT")).toBeVisible();
    expect(screen.getByText("note=NULL")).toBeVisible();
    expect(screen.getByText("note: before -> after")).toBeVisible();
    expect(screen.getByText("id=99")).toBeVisible();
  });

  it("returns stable cross-page targets for every change kind", () => {
    const onNavigate = vi.fn();
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <TableDataChangePreview
          changes={changes}
          columns={columns}
          onNavigate={onNavigate}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Page 3, new row · note=NULL/ }),
    );
    expect(onNavigate).toHaveBeenLastCalledWith({
      pageIndex: 2,
      localId: "local-1",
      columnIndex: 1,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Page 2, row 5 · note: before -> after/,
      }),
    );
    expect(onNavigate).toHaveBeenLastCalledWith({
      pageIndex: 1,
      rowIndex: 4,
      columnIndex: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: /Page 4, row 8 · id=99/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      pageIndex: 3,
      rowIndex: 7,
      columnIndex: 0,
    });
  });
});
