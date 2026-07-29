import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConnectionDialog } from "./ConnectionDialog";
import { connectionApi } from "./connectionApi";

describe("ConnectionDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a successful connection test in the fixed footer", async () => {
    vi.spyOn(connectionApi, "testProfile").mockResolvedValue({
      database: "postgres",
      latencyMs: 65,
      serverVersion: "18.0 (Debian 18.0-1.pgdg13+3)",
      transport: "tls",
    });

    render(
      <I18nProvider>
        <ConnectionDialog
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnected={() => undefined}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Connection name" }), {
      target: { value: "Local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Connection successful");
    expect(status).toHaveTextContent(
      "PostgreSQL 18.0 (Debian 18.0-1.pgdg13+3) · 65 ms · TLS",
    );
    expect(status.closest(".dialog-footer")).not.toBeNull();
  });

  it("persists a profile before opening its active session", async () => {
    const profile = {
      id: "profile-1",
      name: "Local",
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "postgres",
      environment: "development" as const,
      color: "#2f6d52",
      sslMode: "prefer" as const,
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const create = vi.spyOn(connectionApi, "createProfile").mockResolvedValue(profile);
    const connect = vi.spyOn(connectionApi, "connectSaved").mockResolvedValue({
      sessionId: "session-1",
      database: "postgres",
      latencyMs: 10,
      serverVersion: "18.0",
      transport: "plain",
    });
    const onConnected = vi.fn();

    render(
      <I18nProvider>
        <ConnectionDialog
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnected={onConnected}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Connection name" }), {
      target: { value: "Local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));

    await waitFor(() => expect(connect).toHaveBeenCalledWith("profile-1"));
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(
      connect.mock.invocationCallOrder[0]!,
    );
    expect(onConnected).toHaveBeenCalledWith(
      profile,
      expect.objectContaining({ sessionId: "session-1" }),
    );
  });
});
