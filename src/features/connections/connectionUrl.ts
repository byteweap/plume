import type { ConnectionFormValue, SslMode } from "./connection";

export type ConnectionUrlFields = Pick<
  ConnectionFormValue,
  | "host"
  | "port"
  | "database"
  | "username"
  | "password"
  | "sslMode"
  | "rootCertificatePath"
  | "clientCertificatePath"
  | "clientKeyPath"
>;

export type ConnectionUrlErrorCode =
  | "invalid"
  | "scheme"
  | "host"
  | "database"
  | "sslMode";

export class ConnectionUrlParseError extends Error {
  constructor(readonly code: ConnectionUrlErrorCode) {
    super(`Invalid PostgreSQL connection URL (${code}).`);
    this.name = "ConnectionUrlParseError";
  }
}

const sslModes = new Set<SslMode>([
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ConnectionUrlParseError("invalid");
  }
}

function parseSslMode(url: URL): SslMode {
  const sslModeValue = url.searchParams.get("sslmode");
  if (sslModeValue !== null) {
    const sslMode = sslModeValue.toLowerCase();
    if (!sslModes.has(sslMode as SslMode)) {
      throw new ConnectionUrlParseError("sslMode");
    }
    return sslMode as SslMode;
  }

  const ssl = url.searchParams.get("ssl")?.toLowerCase();
  if (ssl === undefined) return "prefer";
  if (["1", "true", "yes", "on"].includes(ssl)) return "require";
  if (["0", "false", "no", "off"].includes(ssl)) return "disable";
  throw new ConnectionUrlParseError("sslMode");
}

export function parsePostgresConnectionUrl(input: string): ConnectionUrlFields {
  const normalizedInput = input.trim();
  if (/%(?![0-9a-f]{2})/i.test(normalizedInput)) {
    throw new ConnectionUrlParseError("invalid");
  }

  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch {
    throw new ConnectionUrlParseError("invalid");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConnectionUrlParseError("scheme");
  }
  if (!url.hostname) throw new ConnectionUrlParseError("host");
  if (url.hash) throw new ConnectionUrlParseError("invalid");

  const encodedDatabase = url.pathname.startsWith("/")
    ? url.pathname.slice(1)
    : url.pathname;
  if (!encodedDatabase || encodedDatabase.includes("/")) {
    throw new ConnectionUrlParseError("database");
  }

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConnectionUrlParseError("invalid");
  }

  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  return {
    host,
    port,
    database: decode(encodedDatabase),
    username: decode(url.username),
    password: decode(url.password),
    sslMode: parseSslMode(url),
    rootCertificatePath: url.searchParams.get("sslrootcert") ?? "",
    clientCertificatePath: url.searchParams.get("sslcert") ?? "",
    clientKeyPath: url.searchParams.get("sslkey") ?? "",
  };
}
