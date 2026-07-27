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

export interface SavedConnection
  extends Omit<ConnectionFormValue, "password" | "rootCertificatePath"> {
  id: string;
  rootCertificatePath?: string;
  sessionId: string;
  serverVersion: string;
}

export const defaultConnectionFormValue: ConnectionFormValue = {
  name: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "",
  environment: "development",
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
