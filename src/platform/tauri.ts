import { invoke } from "@tauri-apps/api/core";

export interface CommandError {
  code: string;
  message: string;
  detail?: string;
  diagnostic?: QueryDiagnostic;
}

export interface QueryDiagnostic {
  sqlState: string;
  severity: string;
  hint?: string;
  position?: number;
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function invokeCommand<TResponse>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResponse> {
  if (!isTauriRuntime()) {
    throw {
      code: "desktop_required",
      message: "This operation requires the Plume desktop runtime.",
    } satisfies CommandError;
  }

  return invoke<TResponse>(command, args);
}

export function toCommandError(error: unknown): CommandError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    const candidate = error as Partial<CommandError>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      const diagnostic = toQueryDiagnostic(candidate.diagnostic);
      return {
        code: candidate.code,
        message: candidate.message,
        detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
        diagnostic,
      };
    }
  }

  return {
    code: "unexpected_error",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
  };
}

function toQueryDiagnostic(value: unknown): QueryDiagnostic | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const candidate = value as Partial<QueryDiagnostic>;
  if (
    typeof candidate.sqlState !== "string" ||
    typeof candidate.severity !== "string"
  ) {
    return undefined;
  }

  return {
    sqlState: candidate.sqlState,
    severity: candidate.severity,
    hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
    position:
      typeof candidate.position === "number" &&
      Number.isInteger(candidate.position) &&
      candidate.position > 0
        ? candidate.position
        : undefined,
  };
}
