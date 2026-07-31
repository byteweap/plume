import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { TableDataFilterBar } from "./TableDataFilterBar";

const columns = [
  { name: "id", ordinal: 0, dataType: { kind: "simple" as const } },
  { name: "name", ordinal: 1, dataType: { kind: "simple" as const } },
];

describe("TableDataFilterBar", () => {
  it("builds multiple value and null conditions", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    const onApply = vi.fn();
    render(
      <I18nProvider>
        <TableDataFilterBar
          columns={columns}
          filters={[]}
          disabled={false}
          onApply={onApply}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter column" }), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter operator" }), {
      target: { value: "contains" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter value" }), {
      target: { value: "Ada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    const operators = screen.getAllByRole("combobox", { name: "Filter operator" });
    fireEvent.change(operators[1]!, { target: { value: "isNull" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith([
      expect.objectContaining({
        columnIndex: 1,
        columnName: "name",
        operator: "contains",
        value: "Ada",
      }),
      expect.objectContaining({
        columnIndex: 0,
        columnName: "id",
        operator: "isNull",
      }),
    ]);
  });
});
