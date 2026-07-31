import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TableDataDeleteSummary } from "./TableDataDeleteSummary";

describe("TableDataDeleteSummary", () => {
  it("shows the deletion count and every row locator", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    render(
      <I18nProvider>
        <TableDataDeleteSummary
          rows={[
            {
              rowId: "row-1",
              locator: {
                keyName: "items_key",
                columns: [
                  { columnName: "tenant", value: "acme" },
                  { columnName: "id", value: "42" },
                ],
              },
              pageIndex: 0,
              rowIndex: 1,
              originalValues: ["acme", "42"],
            },
            {
              rowId: "row-2",
              locator: {
                keyName: "items_key",
                columns: [{ columnName: "id", value: "" }],
              },
              pageIndex: 0,
              rowIndex: 2,
              originalValues: [""],
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("2 rows marked for deletion")).toBeVisible();
    expect(screen.getByText("tenant=acme · id=42")).toBeVisible();
    const emptyKey = screen.getByText("id=''");
    expect(emptyKey).toBeVisible();
  });
});
