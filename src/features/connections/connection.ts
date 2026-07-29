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

export const connectionColors = [
  "#2f6d52",
  "#2563a6",
  "#7c5a18",
  "#9b3a3a",
  "#6b4ba1",
] as const;

export type Environment = (typeof environments)[number];
export type SslMode = (typeof sslModes)[number];

export const connectionFormSchema = z
  .object({
    name: z.string().trim().min(1, "required"),
    host: z.string().trim().min(1, "required"),
    port: z.coerce.number().int().min(1, "port").max(65535, "port"),
    database: z.string().trim().min(1, "required"),
    username: z.string().trim().min(1, "required"),
    password: z.string(),
    environment: z.enum(environments),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    sslMode: z.enum(sslModes),
    rootCertificatePath: z.string().trim(),
  })
  .superRefine((value, context) => {
    const requiresCertificate =
      value.sslMode === "verify-ca" || value.sslMode === "verify-full";
    if (requiresCertificate && !value.rootCertificatePath) {
      context.addIssue({
        code: "custom",
        message: "rootCertificate",
        path: ["rootCertificatePath"],
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

export interface ConnectionProfile
  extends Omit<ConnectionFormValue, "password" | "rootCertificatePath"> {
  id: string;
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

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  authentication: string;
  privateKeyPath?: string;
  jumpHost?: string;
}

export interface ProfileWriteRequest
  extends Omit<ConnectionFormValue, "password" | "rootCertificatePath"> {
  id?: string;
  password?: string;
  rootCertificatePath?: string;
  clientCertificatePath?: string;
  clientKeyPath?: string;
  sshConfig?: SshConfig;
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
  color: connectionColors[0],
  sslMode: "prefer",
  rootCertificatePath: "",
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
    timeoutSeconds: 10,
  };
}

export function toProfileWriteRequest(
  value: ConnectionFormValue,
  existing?: ConnectionProfile,
): ProfileWriteRequest {
  return {
    id: existing?.id,
    name: value.name,
    host: value.host,
    port: value.port,
    database: value.database,
    username: value.username,
    password: value.password || undefined,
    environment: value.environment,
    color: value.color,
    sslMode: value.sslMode,
    rootCertificatePath: value.rootCertificatePath || undefined,
    clientCertificatePath: existing?.clientCertificatePath,
    clientKeyPath: existing?.clientKeyPath,
    sshConfig: existing?.sshConfig,
    favorite: existing?.favorite ?? false,
  };
}

export function profileToFormValue(
  profile: ConnectionProfile,
): ConnectionFormValue {
  return {
    name: profile.name,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    username: profile.username,
    password: "",
    environment: profile.environment,
    color: profile.color,
    sslMode: profile.sslMode,
    rootCertificatePath: profile.rootCertificatePath ?? "",
  };
}
