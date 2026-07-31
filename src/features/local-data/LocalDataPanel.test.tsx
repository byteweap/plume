import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { LocalDataPanel } from "./LocalDataPanel";

describe("LocalDataPanel", () => {
  it("submits the selected local data scope", () => {
    const onClear = vi.fn();
    render(
      <I18nProvider>
        <LocalDataPanel busy={false} onClear={onClear} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Data to clear" }), {
      target: { value: "cache" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalledWith("cache");
  });
});
