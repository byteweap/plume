import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { App } from "./App";

describe("App sidebar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resizes by dragging the right divider", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });
    const content = resizer.parentElement;
    const setPointerCapture = vi.fn();
    Object.defineProperties(resizer, {
      setPointerCapture: { value: setPointerCapture },
      hasPointerCapture: { value: () => false },
    });

    fireEvent.pointerDown(resizer, {
      button: 0,
      clientX: 286,
      pointerId: 1,
    });
    expect(content).toHaveClass("app-content-resizing");

    fireEvent.pointerMove(resizer, { clientX: 386, pointerId: 1 });

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(content).toHaveStyle({ "--sidebar-width": "386px" });

    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(content).not.toHaveClass("app-content-resizing");
  });

  it("supports keyboard resizing and restores the default width", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });
    const content = resizer.parentElement;

    expect(content).toHaveStyle({ "--sidebar-width": "286px" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    expect(content).toHaveStyle({ "--sidebar-width": "302px" });
    expect(resizer).toHaveAttribute("aria-valuenow", "302");

    fireEvent.doubleClick(resizer);
    expect(content).toHaveStyle({ "--sidebar-width": "286px" });
  });

  it("collapses and restores the sidebar at its previous width", () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const sidebar = screen.getByRole("complementary");
    const content = sidebar.parentElement;
    const resizer = screen.getByRole("separator", { name: "Resize sidebar" });

    fireEvent.keyDown(resizer, { key: "ArrowRight" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(content).toHaveStyle({ "--sidebar-width": "0px" });
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(content).toHaveStyle({ "--sidebar-width": "302px" });
    expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(
      screen.getByRole("separator", { name: "Resize sidebar" }),
    ).toBeVisible();
  });
});
