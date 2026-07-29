import { describe, expect, it } from "vitest";
import {
  connectionFormSchema,
  defaultConnectionFormValue,
  profileToFormValue,
  toConnectionTestRequest,
  toProfileWriteRequest,
} from "./connection";

describe("connectionFormSchema", () => {
  it("accepts a valid direct connection", () => {
    const result = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      name: "Local development",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid port", () => {
    const result = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      port: 70_000,
    });
    expect(result.success).toBe(false);
  });

  it("requires a root certificate for verified TLS", () => {
    const result = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      sslMode: "verify-full",
    });
    expect(result.success).toBe(false);
  });

  it("requires client certificate and private key paths as a pair", () => {
    const result = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      name: "Certificate connection",
      sslMode: "require",
      clientCertificatePath: "/tmp/client.crt",
    });
    expect(result.success).toBe(false);
  });

  it("validates enabled SSH and jump-host authentication independently", () => {
    const missingSshPassword = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      name: "Tunnel",
      sshEnabled: true,
      sshHost: "ssh.internal",
      sshUsername: "plume",
    });
    expect(missingSshPassword.success).toBe(false);

    const complete = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      name: "Tunnel",
      sshEnabled: true,
      sshHost: "ssh.internal",
      sshUsername: "plume",
      sshPassword: "ssh-secret",
      jumpHostEnabled: true,
      jumpHost: "jump.internal",
      jumpUsername: "jump",
      jumpAuthentication: "private-key",
      jumpPrivateKeyPath: "/tmp/jump-key",
    });
    expect(complete.success).toBe(true);
  });

  it("ignores inactive SSH port values", () => {
    const result = connectionFormSchema.safeParse({
      ...defaultConnectionFormValue,
      name: "Direct",
      sshPort: 0,
      jumpPort: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("saved profile conversion", () => {
  it("never includes an empty password in a persisted update", () => {
    const profile = {
      ...defaultConnectionFormValue,
      id: "profile-1",
      name: "Local",
      password: undefined,
      rootCertificatePath: undefined,
      clientCertificatePath: undefined,
      clientKeyPath: undefined,
      favorite: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const form = profileToFormValue(profile);
    expect(form.password).toBe("");
    expect(toProfileWriteRequest(form, profile).password).toBeUndefined();
  });

  it("does not expose saved SSH secrets and reuses them on an unchanged edit", () => {
    const profile = {
      id: "profile-ssh",
      name: "Tunnel",
      host: "database.internal",
      port: 5432,
      database: "plume",
      username: "plume",
      environment: "development" as const,
      color: "#2f6d52",
      sslMode: "verify-full" as const,
      rootCertificatePath: "/tmp/root.crt",
      sshConfig: {
        host: "ssh.internal",
        port: 22,
        username: "plume",
        authentication: "password" as const,
        knownHostsPath: "/tmp/known_hosts",
      },
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
    };

    const form = profileToFormValue(profile);
    expect(form.sshPassword).toBe("");
    expect(form.sshPasswordSaved).toBe(true);
    expect(connectionFormSchema.safeParse(form).success).toBe(true);
    expect(toProfileWriteRequest(form, profile)).toMatchObject({
      sshConfig: profile.sshConfig,
      sshPassword: undefined,
    });
  });

  it("builds nested SSH configuration while keeping secrets separate", () => {
    const request = toProfileWriteRequest({
      ...defaultConnectionFormValue,
      name: "Tunnel",
      sshEnabled: true,
      sshHost: "ssh.internal",
      sshUsername: "plume",
      sshPassword: "ssh-secret",
      jumpHostEnabled: true,
      jumpHost: "jump.internal",
      jumpPort: 2222,
      jumpUsername: "jump",
      jumpAuthentication: "private-key",
      jumpPrivateKeyPath: "/tmp/jump-key",
      jumpPrivateKeyPassphrase: "jump-secret",
    });

    expect(request).toMatchObject({
      sshConfig: {
        host: "ssh.internal",
        port: 22,
        username: "plume",
        authentication: "password",
        jumpHost: {
          host: "jump.internal",
          port: 2222,
          username: "jump",
          authentication: "private-key",
          privateKeyPath: "/tmp/jump-key",
        },
      },
      sshPassword: "ssh-secret",
      sshJumpPrivateKeyPassphrase: "jump-secret",
    });
    expect(JSON.stringify(request.sshConfig)).not.toContain("ssh-secret");
  });
});

describe("toConnectionTestRequest", () => {
  it("does not send an empty certificate path", () => {
    expect(toConnectionTestRequest(defaultConnectionFormValue)).toMatchObject({
      rootCertificatePath: undefined,
      clientCertificatePath: undefined,
      clientKeyPath: undefined,
      timeoutSeconds: 10,
    });
  });
});
