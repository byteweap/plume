import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ConnectionDialog } from "./ConnectionDialog";
import { connectionApi } from "./connectionApi";

describe("ConnectionDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("enables client certificate inputs only for SSL modes", () => {
    render(
      <I18nProvider>
        <ConnectionDialog
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnected={() => undefined}
        />
      </I18nProvider>,
    );

    const sslMode = screen.getByRole("combobox", { name: "SSL mode" });
    const certificate = screen.getByRole("textbox", {
      name: /^Client certificate path/,
    });
    const key = screen.getByRole("textbox", {
      name: /^Client private key path/,
    });
    expect(certificate).toBeEnabled();
    expect(key).toBeEnabled();

    fireEvent.change(certificate, { target: { value: "/tmp/client.crt" } });
    fireEvent.change(key, { target: { value: "/tmp/client.key" } });
    fireEvent.change(sslMode, { target: { value: "disable" } });
    expect(certificate).toBeDisabled();
    expect(key).toBeDisabled();
    expect(certificate).toHaveValue("");
    expect(key).toHaveValue("");
  });

  it("progressively reveals SSH and jump-host controls", () => {
    render(
      <I18nProvider>
        <ConnectionDialog
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnected={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole("textbox", { name: "SSH host" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use an SSH tunnel" }));
    expect(screen.getByRole("textbox", { name: "SSH host" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Jump host" })).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Connect through a jump host" }),
    );
    expect(screen.getByRole("textbox", { name: "Jump host" })).toBeVisible();
  });

  it("keeps production SQL protection enabled while other environments are adjustable", () => {
    render(
      <I18nProvider>
        <ConnectionDialog
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnected={() => undefined}
        />
      </I18nProvider>,
    );

    const environment = screen.getByRole("combobox", { name: "Environment" });
    const policy = screen.getByRole("combobox", { name: /SQL risk prompts/ });
    fireEvent.change(policy, { target: { value: "off" } });
    expect(policy).toHaveValue("off");

    fireEvent.change(environment, { target: { value: "production" } });
    expect(policy).toHaveValue("critical-only");
    expect(screen.getByRole("option", { name: "Disable prompts" })).toBeDisabled();
    expect(screen.getByText(/Production connections must retain/)).toBeVisible();
  });

  it("sends SSH and jump-host secrets outside the persisted config", async () => {
    const testProfile = vi.spyOn(connectionApi, "testProfile").mockResolvedValue({
      database: "postgres",
      latencyMs: 12,
      serverVersion: "18.0",
      transport: "plain",
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
      target: { value: "Tunnel" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Use an SSH tunnel" }));
    fireEvent.change(screen.getByRole("textbox", { name: "SSH host" }), {
      target: { value: "ssh.internal" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "SSH username" }), {
      target: { value: "plume" },
    });
    fireEvent.change(screen.getByLabelText("SSH password"), {
      target: { value: "ssh-secret" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Connect through a jump host" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Jump host" }), {
      target: { value: "jump.internal" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Jump host username" }), {
      target: { value: "jump" },
    });
    fireEvent.change(screen.getByLabelText("Jump host password"), {
      target: { value: "jump-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(testProfile).toHaveBeenCalledOnce());
    expect(testProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        sshConfig: expect.objectContaining({
          host: "ssh.internal",
          jumpHost: expect.objectContaining({ host: "jump.internal" }),
        }),
        sshPassword: "ssh-secret",
        sshJumpPassword: "jump-secret",
      }),
    );
  });

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

  it("uses safe reconnect when editing an active profile", async () => {
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
    vi.spyOn(connectionApi, "updateProfile").mockResolvedValue(profile);
    const reconnect = vi.spyOn(connectionApi, "reconnectSaved").mockResolvedValue({
      sessionId: "session-2",
      database: "postgres",
      latencyMs: 8,
      serverVersion: "18.1",
      transport: "plain",
    });
    const onConnecting = vi.fn();

    render(
      <I18nProvider>
        <ConnectionDialog
          profile={profile}
          currentSessionId="session-1"
          onClose={() => undefined}
          onSaved={() => undefined}
          onConnecting={onConnecting}
          onConnected={() => undefined}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));

    await waitFor(() =>
      expect(reconnect).toHaveBeenCalledWith("profile-1", "session-1"),
    );
    expect(onConnecting).toHaveBeenCalledWith(profile);
  });
});
