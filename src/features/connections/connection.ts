import { z } from "zod";

export const environments = [
  "development",
  "test",
  "staging",
  "production",
] as const;

export const sslModes = [
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
] as const;

export const sshAuthentications = ["password", "private-key"] as const;
export const sqlRiskPolicies = ["all", "critical-only", "off"] as const;

export const connectionColors = [
  "#2f6d52",
  "#2563a6",
  "#7c5a18",
  "#9b3a3a",
  "#6b4ba1",
] as const;

export type Environment = (typeof environments)[number];
export type SslMode = (typeof sslModes)[number];
export type SshAuthentication = (typeof sshAuthentications)[number];
export type SqlRiskPolicy = (typeof sqlRiskPolicies)[number];

export const connectionFormSchema = z
  .object({
    name: z.string().trim().min(1, "required"),
    host: z.string().trim().min(1, "required"),
    port: z.coerce.number().int().min(1, "port").max(65535, "port"),
    database: z.string().trim().min(1, "required"),
    username: z.string().trim().min(1, "required"),
    password: z.string(),
    environment: z.enum(environments),
    sqlRiskPolicy: z.enum(sqlRiskPolicies),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    sslMode: z.enum(sslModes),
    rootCertificatePath: z.string().trim(),
    clientCertificatePath: z.string().trim(),
    clientKeyPath: z.string().trim(),
    sshEnabled: z.boolean(),
    sshHost: z.string().trim(),
    sshPort: z.coerce.number().int(),
    sshUsername: z.string().trim(),
    sshAuthentication: z.enum(sshAuthentications),
    sshPassword: z.string(),
    sshPasswordSaved: z.boolean(),
    sshPrivateKeyPath: z.string().trim(),
    sshPrivateKeyPassphrase: z.string(),
    sshKnownHostsPath: z.string().trim(),
    jumpHostEnabled: z.boolean(),
    jumpHost: z.string().trim(),
    jumpPort: z.coerce.number().int(),
    jumpUsername: z.string().trim(),
    jumpAuthentication: z.enum(sshAuthentications),
    jumpPassword: z.string(),
    jumpPasswordSaved: z.boolean(),
    jumpPrivateKeyPath: z.string().trim(),
    jumpPrivateKeyPassphrase: z.string(),
    jumpKnownHostsPath: z.string().trim(),
  })
  .superRefine((value, context) => {
    if (value.environment === "production" && value.sqlRiskPolicy === "off") {
      context.addIssue({
        code: "custom",
        message: "productionRiskPolicy",
        path: ["sqlRiskPolicy"],
      });
    }
    const requiresCertificate =
      value.sslMode === "verify-ca" || value.sslMode === "verify-full";
    if (requiresCertificate && !value.rootCertificatePath) {
      context.addIssue({
        code: "custom",
        message: "rootCertificate",
        path: ["rootCertificatePath"],
      });
    }
    const clientCredentialsArePaired =
      Boolean(value.clientCertificatePath) === Boolean(value.clientKeyPath);
    if (!clientCredentialsArePaired) {
      const path = value.clientCertificatePath
        ? "clientKeyPath"
        : "clientCertificatePath";
      context.addIssue({
        code: "custom",
        message: "clientCertificatePair",
        path: [path],
      });
    }
    if (value.sslMode === "disable" && value.clientCertificatePath) {
      context.addIssue({
        code: "custom",
        message: "clientCertificateSsl",
        path: ["clientCertificatePath"],
      });
    }
    if (!value.sshEnabled) return;

    for (const field of ["sshHost", "sshUsername"] as const) {
      if (!value[field]) {
        context.addIssue({ code: "custom", message: "required", path: [field] });
      }
    }
    if (value.sshPort < 1 || value.sshPort > 65535) {
      context.addIssue({ code: "custom", message: "port", path: ["sshPort"] });
    }
    if (
      value.sshAuthentication === "password" &&
      !value.sshPassword &&
      !value.sshPasswordSaved
    ) {
      context.addIssue({
        code: "custom",
        message: "sshPassword",
        path: ["sshPassword"],
      });
    }
    if (value.sshAuthentication === "private-key" && !value.sshPrivateKeyPath) {
      context.addIssue({
        code: "custom",
        message: "sshPrivateKey",
        path: ["sshPrivateKeyPath"],
      });
    }
    if (!value.jumpHostEnabled) return;

    for (const field of ["jumpHost", "jumpUsername"] as const) {
      if (!value[field]) {
        context.addIssue({ code: "custom", message: "required", path: [field] });
      }
    }
    if (value.jumpPort < 1 || value.jumpPort > 65535) {
      context.addIssue({ code: "custom", message: "port", path: ["jumpPort"] });
    }
    if (
      value.jumpAuthentication === "password" &&
      !value.jumpPassword &&
      !value.jumpPasswordSaved
    ) {
      context.addIssue({
        code: "custom",
        message: "sshPassword",
        path: ["jumpPassword"],
      });
    }
    if (value.jumpAuthentication === "private-key" && !value.jumpPrivateKeyPath) {
      context.addIssue({
        code: "custom",
        message: "sshPrivateKey",
        path: ["jumpPrivateKeyPath"],
      });
    }
  });

export type ConnectionFormValue = z.infer<typeof connectionFormSchema>;

export interface ConnectionTestRequest {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  rootCertificatePath?: string;
  clientCertificatePath?: string;
  clientKeyPath?: string;
  timeoutSeconds: number;
}

export interface ConnectionTestResult {
  database: string;
  latencyMs: number;
  serverVersion: string;
  transport: "plain" | "tls";
}

export interface ConnectedDatabaseResult extends ConnectionTestResult {
  sessionId: string;
}

export interface SessionHealth {
  sessionId: string;
  state: "connected";
  databaseCount: number;
}

export interface ConnectionProfile
  extends Omit<
    ConnectionFormValue,
    | "password"
    | "sqlRiskPolicy"
    | "rootCertificatePath"
    | "clientCertificatePath"
    | "clientKeyPath"
    | "sshEnabled"
    | "sshHost"
    | "sshPort"
    | "sshUsername"
    | "sshAuthentication"
    | "sshPassword"
    | "sshPasswordSaved"
    | "sshPrivateKeyPath"
    | "sshPrivateKeyPassphrase"
    | "sshKnownHostsPath"
    | "jumpHostEnabled"
    | "jumpHost"
    | "jumpPort"
    | "jumpUsername"
    | "jumpAuthentication"
    | "jumpPassword"
    | "jumpPasswordSaved"
    | "jumpPrivateKeyPath"
    | "jumpPrivateKeyPassphrase"
    | "jumpKnownHostsPath"
  > {
  id: string;
  sqlRiskPolicy?: SqlRiskPolicy;
  rootCertificatePath?: string;
  clientCertificatePath?: string;
  clientKeyPath?: string;
  sshConfig?: SshConfig;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ActiveConnection extends ConnectionProfile {
  sessionId: string;
  serverVersion: string;
}

export type SavedConnection = ActiveConnection;

export interface SshEndpointConfig {
  host: string;
  port: number;
  username: string;
  authentication: SshAuthentication;
  privateKeyPath?: string;
  knownHostsPath?: string;
}

export interface SshConfig extends SshEndpointConfig {
  jumpHost?: SshEndpointConfig;
}

export interface ProfileWriteRequest
  extends Omit<
    ConnectionFormValue,
    | "password"
    | "rootCertificatePath"
    | "clientCertificatePath"
    | "clientKeyPath"
    | "sshEnabled"
    | "sshHost"
    | "sshPort"
    | "sshUsername"
    | "sshAuthentication"
    | "sshPassword"
    | "sshPasswordSaved"
    | "sshPrivateKeyPath"
    | "sshPrivateKeyPassphrase"
    | "sshKnownHostsPath"
    | "jumpHostEnabled"
    | "jumpHost"
    | "jumpPort"
    | "jumpUsername"
    | "jumpAuthentication"
    | "jumpPassword"
    | "jumpPasswordSaved"
    | "jumpPrivateKeyPath"
    | "jumpPrivateKeyPassphrase"
    | "jumpKnownHostsPath"
  > {
  id?: string;
  password?: string;
  rootCertificatePath?: string;
  clientCertificatePath?: string;
  clientKeyPath?: string;
  sshConfig?: SshConfig;
  sshPassword?: string;
  sshPrivateKeyPassphrase?: string;
  sshJumpPassword?: string;
  sshJumpPrivateKeyPassphrase?: string;
  favorite: boolean;
}

export const defaultConnectionFormValue: ConnectionFormValue = {
  name: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  environment: "development",
  sqlRiskPolicy: "all",
  color: connectionColors[0],
  sslMode: "prefer",
  rootCertificatePath: "",
  clientCertificatePath: "",
  clientKeyPath: "",
  sshEnabled: false,
  sshHost: "",
  sshPort: 22,
  sshUsername: "",
  sshAuthentication: "password",
  sshPassword: "",
  sshPasswordSaved: false,
  sshPrivateKeyPath: "",
  sshPrivateKeyPassphrase: "",
  sshKnownHostsPath: "",
  jumpHostEnabled: false,
  jumpHost: "",
  jumpPort: 22,
  jumpUsername: "",
  jumpAuthentication: "password",
  jumpPassword: "",
  jumpPasswordSaved: false,
  jumpPrivateKeyPath: "",
  jumpPrivateKeyPassphrase: "",
  jumpKnownHostsPath: "",
};

export function toConnectionTestRequest(
  value: ConnectionFormValue,
): ConnectionTestRequest {
  return {
    host: value.host,
    port: value.port,
    database: value.database,
    username: value.username,
    password: value.password,
    sslMode: value.sslMode,
    rootCertificatePath: value.rootCertificatePath || undefined,
    clientCertificatePath: value.clientCertificatePath || undefined,
    clientKeyPath: value.clientKeyPath || undefined,
    timeoutSeconds: 10,
  };
}

export function toProfileWriteRequest(
  value: ConnectionFormValue,
  existing?: ConnectionProfile,
): ProfileWriteRequest {
  const jumpHost: SshEndpointConfig | undefined =
    value.sshEnabled && value.jumpHostEnabled
      ? {
          host: value.jumpHost,
          port: value.jumpPort,
          username: value.jumpUsername,
          authentication: value.jumpAuthentication,
          privateKeyPath: value.jumpPrivateKeyPath || undefined,
          knownHostsPath: value.jumpKnownHostsPath || undefined,
        }
      : undefined;
  const sshConfig: SshConfig | undefined = value.sshEnabled
    ? {
        host: value.sshHost,
        port: value.sshPort,
        username: value.sshUsername,
        authentication: value.sshAuthentication,
        privateKeyPath: value.sshPrivateKeyPath || undefined,
        knownHostsPath: value.sshKnownHostsPath || undefined,
        jumpHost,
      }
    : undefined;

  return {
    id: existing?.id,
    name: value.name,
    host: value.host,
    port: value.port,
    database: value.database,
    username: value.username,
    password: value.password || undefined,
    environment: value.environment,
    sqlRiskPolicy: value.sqlRiskPolicy,
    color: value.color,
    sslMode: value.sslMode,
    rootCertificatePath: value.rootCertificatePath || undefined,
    clientCertificatePath: value.clientCertificatePath || undefined,
    clientKeyPath: value.clientKeyPath || undefined,
    sshConfig,
    sshPassword: value.sshEnabled ? value.sshPassword || undefined : undefined,
    sshPrivateKeyPassphrase: value.sshEnabled
      ? value.sshPrivateKeyPassphrase || undefined
      : undefined,
    sshJumpPassword:
      value.sshEnabled && value.jumpHostEnabled
        ? value.jumpPassword || undefined
        : undefined,
    sshJumpPrivateKeyPassphrase:
      value.sshEnabled && value.jumpHostEnabled
        ? value.jumpPrivateKeyPassphrase || undefined
        : undefined,
    favorite: existing?.favorite ?? false,
  };
}

export function profileToFormValue(
  profile: ConnectionProfile,
): ConnectionFormValue {
  const ssh = profile.sshConfig;
  const jump = ssh?.jumpHost;
  return {
    name: profile.name,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    username: profile.username,
    password: "",
    environment: profile.environment,
    sqlRiskPolicy: profile.sqlRiskPolicy ?? "all",
    color: profile.color,
    sslMode: profile.sslMode,
    rootCertificatePath: profile.rootCertificatePath ?? "",
    clientCertificatePath: profile.clientCertificatePath ?? "",
    clientKeyPath: profile.clientKeyPath ?? "",
    sshEnabled: Boolean(ssh),
    sshHost: ssh?.host ?? "",
    sshPort: ssh?.port ?? 22,
    sshUsername: ssh?.username ?? "",
    sshAuthentication: ssh?.authentication ?? "password",
    sshPassword: "",
    sshPasswordSaved: ssh?.authentication === "password",
    sshPrivateKeyPath: ssh?.privateKeyPath ?? "",
    sshPrivateKeyPassphrase: "",
    sshKnownHostsPath: ssh?.knownHostsPath ?? "",
    jumpHostEnabled: Boolean(jump),
    jumpHost: jump?.host ?? "",
    jumpPort: jump?.port ?? 22,
    jumpUsername: jump?.username ?? "",
    jumpAuthentication: jump?.authentication ?? "password",
    jumpPassword: "",
    jumpPasswordSaved: jump?.authentication === "password",
    jumpPrivateKeyPath: jump?.privateKeyPath ?? "",
    jumpPrivateKeyPassphrase: "",
    jumpKnownHostsPath: jump?.knownHostsPath ?? "",
  };
}
