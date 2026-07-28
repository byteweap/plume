import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConnectionDialog } from "./ConnectionDialog";
import { connectionApi } from "./connectionApi";

describe("ConnectionDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a successful connection test in the fixed footer", async () => {
    vi.spyOn(connectionApi, "test").mockResolvedValue({
      database: "postgres",
      latencyMs: 65,
      serverVersion: "18.0 (Debian 18.0-1.pgdg13+3)",
      transport: "tls",
    });

    render(
      <I18nProvider>
        <ConnectionDialog onClose={() => undefined} onConnected={() => undefined} />
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
});
