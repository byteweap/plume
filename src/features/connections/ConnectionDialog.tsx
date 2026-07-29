import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, LoaderCircle, Server, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import type { TranslationKey } from "../../i18n/catalog";
import { toCommandError } from "../../platform/tauri";
import { IconButton } from "../../shared/IconButton";
import {
  connectionFormSchema,
  connectionColors,
  defaultConnectionFormValue,
  environments,
  profileToFormValue,
  sslModes,
  toProfileWriteRequest,
  type ConnectedDatabaseResult,
  type ConnectionFormValue,
  type ConnectionProfile,
  type ConnectionTestResult,
} from "./connection";
import { connectionApi } from "./connectionApi";
import "./ConnectionDialog.css";

interface ConnectionDialogProps {
  profile?: ConnectionProfile;
  onClose: () => void;
  onSaved: (profile: ConnectionProfile) => void;
  onConnected: (
    profile: ConnectionProfile,
    result: ConnectedDatabaseResult,
  ) => void;
}

type FieldErrors = Partial<Record<keyof ConnectionFormValue, TranslationKey>>;
type RequestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; result: ConnectionTestResult }
  | { status: "error"; message: string };

const validationKeys = {
  required: "validation.required",
  port: "validation.port",
  rootCertificate: "validation.rootCertificate",
} as const satisfies Record<string, TranslationKey>;

function getFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): FieldErrors {
  return issues.reduce<FieldErrors>((errors, issue) => {
    const field = issue.path[0];
    if (typeof field !== "string") return errors;

    const key = validationKeys[issue.message as keyof typeof validationKeys];
    if (key) errors[field as keyof ConnectionFormValue] = key;
    return errors;
  }, {});
}

export function ConnectionDialog({
  profile,
  onClose,
  onSaved,
  onConnected,
}: ConnectionDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const [form, setForm] = useState<ConnectionFormValue>(
    profile ? profileToFormValue(profile) : defaultConnectionFormValue,
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [requestState, setRequestState] = useState<RequestState>({
    status: "idle",
  });
  const [showPassword, setShowPassword] = useState(false);

  function updateField<Key extends keyof ConnectionFormValue>(
    field: Key,
    value: ConnectionFormValue[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  async function testConnection(closeAfterSuccess: boolean) {
    const parsed = connectionFormSchema.safeParse(form);
    if (!parsed.success) {
      setFieldErrors(getFieldErrors(parsed.error.issues));
      return;
    }

    setFieldErrors({});
    setRequestState({ status: "testing" });

    try {
      if (closeAfterSuccess) {
        const savedProfile = profile
          ? await connectionApi.updateProfile(
              toProfileWriteRequest(parsed.data, profile),
            )
          : await connectionApi.createProfile(toProfileWriteRequest(parsed.data));
        onSaved(savedProfile);
        const result = await connectionApi.connectSaved(savedProfile.id);
        setRequestState({ status: "success", result });
        onConnected(savedProfile, result);
      } else {
        const result = await connectionApi.testProfile(
          toProfileWriteRequest(parsed.data, profile),
        );
        setRequestState({ status: "success", result });
      }
    } catch (error) {
      const commandError = toCommandError(error);
      setRequestState({
        status: "error",
        message:
          commandError.code === "desktop_required"
            ? t("connection.desktopRequired")
            : commandError.message,
      });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void testConnection(true);
  }

  const requiresCertificate =
    form.sslMode === "verify-ca" || form.sslMode === "verify-full";
  const isTesting = requestState.status === "testing";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-header">
          <div className="dialog-title-group">
            <span className="dialog-icon" aria-hidden="true">
              <Server size={18} strokeWidth={1.8} />
            </span>
            <div>
              <h2 id={titleId}>
                {t(profile ? "connection.editTitle" : "connection.newTitle")}
              </h2>
              <p>PostgreSQL 14+</p>
            </div>
          </div>
          <IconButton label={t("connection.close")} onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="dialog-body">
            <fieldset>
              <legend>{t("connection.section.basic")}</legend>
              <div className="form-grid">
                <Field label={t("connection.name")} error={fieldErrors.name && t(fieldErrors.name)}>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    placeholder="Local development"
                  />
                </Field>

                <Field
                  label={t("connection.environment")}
                  error={fieldErrors.environment && t(fieldErrors.environment)}
                >
                  <select
                    value={form.environment}
                    onChange={(event) =>
                      updateField(
                        "environment",
                        event.target.value as ConnectionFormValue["environment"],
                      )
                    }
                  >
                    {environments.map((environment) => (
                      <option key={environment} value={environment}>
                        {t(`environment.${environment}`)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("connection.color")} className="form-field-wide">
                  <div className="color-options" role="radiogroup">
                    {connectionColors.map((color) => (
                      <button
                        key={color}
                        className={`color-swatch ${form.color === color ? "color-swatch-selected" : ""}`}
                        type="button"
                        role="radio"
                        aria-checked={form.color === color}
                        aria-label={color}
                        style={{ backgroundColor: color }}
                        onClick={() => updateField("color", color)}
                      />
                    ))}
                  </div>
                </Field>

                <Field label={t("connection.host")} error={fieldErrors.host && t(fieldErrors.host)}>
                  <input
                    value={form.host}
                    onChange={(event) => updateField("host", event.target.value)}
                    spellCheck={false}
                  />
                </Field>

                <Field label={t("connection.port")} error={fieldErrors.port && t(fieldErrors.port)}>
                  <input
                    inputMode="numeric"
                    value={form.port}
                    onChange={(event) =>
                      updateField("port", Number(event.target.value))
                    }
                  />
                </Field>

                <Field
                  label={t("connection.database")}
                  error={fieldErrors.database && t(fieldErrors.database)}
                >
                  <input
                    value={form.database}
                    onChange={(event) => updateField("database", event.target.value)}
                    spellCheck={false}
                  />
                </Field>

                <Field
                  label={t("connection.username")}
                  error={fieldErrors.username && t(fieldErrors.username)}
                >
                  <input
                    value={form.username}
                    onChange={(event) => updateField("username", event.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                  />
                </Field>

                <Field
                  className="form-field-wide"
                  label={t("connection.password")}
                  error={fieldErrors.password && t(fieldErrors.password)}
                >
                  <div className="password-input">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={(event) => updateField("password", event.target.value)}
                      autoComplete="current-password"
                    />
                    <IconButton
                      type="button"
                      label={
                        showPassword
                          ? t("connection.passwordHide")
                          : t("connection.passwordShow")
                      }
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconButton>
                  </div>
                </Field>
              </div>
            </fieldset>

            <fieldset>
              <legend>{t("connection.section.security")}</legend>
              <div className="form-grid">
                <Field
                  label={t("connection.sslMode")}
                  error={fieldErrors.sslMode && t(fieldErrors.sslMode)}
                >
                  <select
                    value={form.sslMode}
                    onChange={(event) =>
                      updateField(
                        "sslMode",
                        event.target.value as ConnectionFormValue["sslMode"],
                      )
                    }
                  >
                    {sslModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(
                          mode === "verify-ca"
                            ? "ssl.verifyCa"
                            : mode === "verify-full"
                              ? "ssl.verifyFull"
                              : `ssl.${mode}`,
                        )}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label={t("connection.rootCertificate")}
                  hint={t("connection.rootCertificateHint")}
                  error={
                    fieldErrors.rootCertificatePath &&
                    t(fieldErrors.rootCertificatePath)
                  }
                >
                  <input
                    disabled={!requiresCertificate}
                    value={form.rootCertificatePath}
                    onChange={(event) =>
                      updateField("rootCertificatePath", event.target.value)
                    }
                    placeholder="/path/to/root.crt"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </fieldset>

          </div>

          <footer className="dialog-footer">
            <button className="button button-quiet" type="button" onClick={onClose}>
              {t("connection.cancel")}
            </button>
            <div className="dialog-status-slot">
              <ConnectionStatus state={requestState} />
            </div>
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={isTesting}
                onClick={() => void testConnection(false)}
              >
                {isTesting && <LoaderCircle className="spin" size={15} />}
                {isTesting ? t("connection.testing") : t("connection.test")}
              </button>
              <button className="button button-primary" type="submit" disabled={isTesting}>
                {t("connection.save")}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  error?: string;
  hint?: string;
}

function Field({ label, children, className = "", error, hint }: FieldProps) {
  return (
    <label className={`form-field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function ConnectionStatus({ state }: { state: RequestState }) {
  const { t } = useI18n();
  if (state.status === "idle" || state.status === "testing") return null;

  if (state.status === "error") {
    return (
      <div className="connection-status connection-status-error" role="alert">
        {state.message}
      </div>
    );
  }

  const details = `PostgreSQL ${state.result.serverVersion} · ${state.result.latencyMs} ms · ${state.result.transport.toUpperCase()}`;

  return (
    <div className="connection-status connection-status-success" role="status">
      <strong>{t("connection.success")}</strong>
      <span title={details}>{details}</span>
    </div>
  );
}
