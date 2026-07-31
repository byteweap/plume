import { describe, expect, it } from "vitest";
import {
  ConnectionUrlParseError,
  parsePostgresConnectionUrl,
} from "./connectionUrl";

describe("parsePostgresConnectionUrl", () => {
  it.each(["postgres", "postgresql"])(
    "parses the %s scheme with PostgreSQL defaults",
    (scheme) => {
      expect(
        parsePostgresConnectionUrl(`${scheme}://alice@db.internal/plume`),
      ).toEqual({
        host: "db.internal",
        port: 5432,
        database: "plume",
        username: "alice",
        password: "",
        sslMode: "prefer",
        rootCertificatePath: "",
        clientCertificatePath: "",
        clientKeyPath: "",
      });
    },
  );

  it("decodes credentials, database names, and certificate paths exactly once", () => {
    expect(
      parsePostgresConnectionUrl(
        "postgresql://first%2Elast:p%40ss%3Aword@db.internal:6543/sales%20data" +
          "?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem" +
          "&sslcert=%2Fcerts%2Fclient.pem&sslkey=%2Fcerts%2Fclient.key",
      ),
    ).toEqual({
      host: "db.internal",
      port: 6543,
      database: "sales data",
      username: "first.last",
      password: "p@ss:word",
      sslMode: "verify-full",
      rootCertificatePath: "/certs/root.pem",
      clientCertificatePath: "/certs/client.pem",
      clientKeyPath: "/certs/client.key",
    });
  });

  it("normalizes bracketed IPv6 hosts and common boolean SSL parameters", () => {
    expect(
      parsePostgresConnectionUrl("postgres://user@[2001:db8::1]/app?ssl=true"),
    ).toMatchObject({
      host: "2001:db8::1",
      port: 5432,
      sslMode: "require",
    });
    expect(
      parsePostgresConnectionUrl("postgres://user@localhost/app?ssl=off"),
    ).toMatchObject({ sslMode: "disable" });
    expect(
      parsePostgresConnectionUrl("postgres://user@localhost/app?sslmode=REQUIRE"),
    ).toMatchObject({ sslMode: "require" });
  });

  it.each([
    ["mysql://user@localhost/app", "scheme"],
    ["postgres://user@/app", "invalid"],
    ["postgres://user@localhost", "database"],
    ["postgres://user@localhost/one/two", "database"],
    ["postgres://user@localhost/app?sslmode=unsafe", "sslMode"],
    ["postgres://user:p%ZZ@localhost/app", "invalid"],
    ["postgres://user@localhost/app#secret", "invalid"],
  ] as const)("rejects %s without exposing its contents", (url, code) => {
    try {
      parsePostgresConnectionUrl(url);
      throw new Error("Expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionUrlParseError);
      expect((error as ConnectionUrlParseError).code).toBe(code);
      expect((error as Error).message).not.toContain(url);
    }
  });
});
