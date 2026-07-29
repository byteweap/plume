import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { ConnectionProfile } from "../features/connections/connection";
import { connectionApi } from "../features/connections/connectionApi";
import { App } from "./App";

const savedProfile: ConnectionProfile = {
  id: "profile-1",
  name: "Local saved",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  environment: "development",
  color: "#2f6d52",
  sslMode: "disable",
  favorite: true,
  createdAt: 1,
  updatedAt: 1,
};

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

  it("restores saved profiles without connecting until the user selects one", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const savedConnection = await screen.findByRole("button", {
      name: /Local saved/,
    });
    expect(savedConnection).toHaveTextContent("Disconnected");
    expect(connectSaved).not.toHaveBeenCalled();

    fireEvent.click(savedConnection);
    await waitFor(() => expect(connectSaved).toHaveBeenCalledWith("profile-1"));
    expect(await screen.findByText("PostgreSQL 18.0")).toBeVisible();
  });

  it("checks, explicitly reconnects, and disconnects without replaying the initial connect", async () => {
    vi.spyOn(connectionApi, "listProfiles").mockResolvedValue([savedProfile]);
    const connectSaved = vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
    });
    vi.spyOn(connectionApi, "checkSession").mockRejectedValue({
      code: "connection_failed",
      message: "The PostgreSQL session closed.",
    });
    const reconnectSaved = vi
      .spyOn(connectionApi, "reconnectSaved")
      .mockResolvedValue({
        sessionId: "session-2",
        database: "postgres",
        latencyMs: 9,
        serverVersion: "18.1",
        transport: "plain",
      });
    const disconnect = vi.spyOn(connectionApi, "disconnect").mockResolvedValue();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Local saved/ }),
    );
    await screen.findByText("PostgreSQL 18.0");

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Check connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The PostgreSQL session closed.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(reconnectSaved).toHaveBeenCalledWith("profile-1", "session-1"),
    );
    expect(await screen.findByText("PostgreSQL 18.1")).toBeVisible();
    expect(connectSaved).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Connection actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("session-2"));
    expect(await screen.findByText(/Disconnected · localhost:5432/)).toBeVisible();
  });
});
