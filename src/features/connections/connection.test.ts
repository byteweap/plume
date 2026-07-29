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
