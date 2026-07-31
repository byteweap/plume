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
  sqlRiskPolicies,
  sshAuthentications,
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
  currentSessionId?: string;
  onClose: () => void;
  onSaved: (profile: ConnectionProfile) => void;
  onConnecting?: (profile: ConnectionProfile) => void;
  onConnectionFailed?: (profileId: string, message: string) => void;
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
  clientCertificatePair: "validation.clientCertificatePair",
  clientCertificateSsl: "validation.clientCertificateSsl",
  sshPassword: "validation.sshPassword",
  sshPrivateKey: "validation.sshPrivateKey",
  productionRiskPolicy: "validation.productionRiskPolicy",
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
  currentSessionId,
  onClose,
  onSaved,
  onConnecting,
  onConnectionFailed,
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
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showSshPassphrase, setShowSshPassphrase] = useState(false);
  const [showJumpPassword, setShowJumpPassword] = useState(false);
  const [showJumpPassphrase, setShowJumpPassphrase] = useState(false);

  function updateField<Key extends keyof ConnectionFormValue>(
    field: Key,
    value: ConnectionFormValue[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateEnvironment(environment: ConnectionFormValue["environment"]) {
    setForm((current) => ({
      ...current,
      environment,
      sqlRiskPolicy:
        environment === "production" && current.sqlRiskPolicy === "off"
          ? "critical-only"
          : current.sqlRiskPolicy,
    }));
    setFieldErrors((current) => ({
      ...current,
      environment: undefined,
      sqlRiskPolicy: undefined,
    }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateSslMode(sslMode: ConnectionFormValue["sslMode"]) {
    setForm((current) => ({
      ...current,
      sslMode,
      ...(sslMode === "disable"
        ? { clientCertificatePath: "", clientKeyPath: "" }
        : {}),
    }));
    setFieldErrors((current) => ({
      ...current,
      sslMode: undefined,
      clientCertificatePath: undefined,
      clientKeyPath: undefined,
    }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateSshEnabled(sshEnabled: boolean) {
    setForm((current) => ({
      ...current,
      sshEnabled,
      ...(!sshEnabled
        ? {
            sshPassword: "",
            sshPasswordSaved: false,
            sshPrivateKeyPassphrase: "",
            jumpPassword: "",
            jumpPasswordSaved: false,
            jumpPrivateKeyPassphrase: "",
          }
        : {}),
    }));
    setFieldErrors({});
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateJumpHostEnabled(jumpHostEnabled: boolean) {
    setForm((current) => ({
      ...current,
      jumpHostEnabled,
      ...(!jumpHostEnabled
        ? {
            jumpPassword: "",
            jumpPasswordSaved: false,
            jumpPrivateKeyPassphrase: "",
          }
        : {}),
    }));
    setFieldErrors((current) => ({
      ...current,
      jumpHost: undefined,
      jumpPort: undefined,
      jumpUsername: undefined,
      jumpPassword: undefined,
      jumpPrivateKeyPath: undefined,
    }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateSshAuthentication(
    authentication: ConnectionFormValue["sshAuthentication"],
  ) {
    setForm((current) => ({
      ...current,
      sshAuthentication: authentication,
      sshPassword: "",
      sshPasswordSaved: false,
      sshPrivateKeyPassphrase: "",
    }));
    setFieldErrors((current) => ({
      ...current,
      sshPassword: undefined,
      sshPrivateKeyPath: undefined,
    }));
    if (requestState.status !== "idle") setRequestState({ status: "idle" });
  }

  function updateJumpAuthentication(
    authentication: ConnectionFormValue["jumpAuthentication"],
  ) {
    setForm((current) => ({
      ...current,
      jumpAuthentication: authentication,
      jumpPassword: "",
      jumpPasswordSaved: false,
      jumpPrivateKeyPassphrase: "",
    }));
    setFieldErrors((current) => ({
      ...current,
      jumpPassword: undefined,
      jumpPrivateKeyPath: undefined,
    }));
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
    let attemptedProfileId: string | undefined;

    try {
      if (closeAfterSuccess) {
        const savedProfile = profile
          ? await connectionApi.updateProfile(
              toProfileWriteRequest(parsed.data, profile),
            )
          : await connectionApi.createProfile(toProfileWriteRequest(parsed.data));
        attemptedProfileId = savedProfile.id;
        onSaved(savedProfile);
        onConnecting?.(savedProfile);
        const result = currentSessionId
          ? await connectionApi.reconnectSaved(savedProfile.id, currentSessionId)
          : await connectionApi.connectSaved(savedProfile.id);
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
      if (closeAfterSuccess && attemptedProfileId) {
        onConnectionFailed?.(attemptedProfileId, commandError.message);
      }
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
  const usesTls = form.sslMode !== "disable";
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
                      updateEnvironment(
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

                <Field
                  className="form-field-wide"
                  label={t("connection.sqlRiskPolicy")}
                  hint={
                    form.environment === "production"
                      ? t("connection.sqlRiskPolicyProductionHint")
                      : t("connection.sqlRiskPolicyHint")
                  }
                  error={
                    fieldErrors.sqlRiskPolicy && t(fieldErrors.sqlRiskPolicy)
                  }
                >
                  <select
                    value={form.sqlRiskPolicy}
                    onChange={(event) =>
                      updateField(
                        "sqlRiskPolicy",
                        event.target.value as ConnectionFormValue["sqlRiskPolicy"],
                      )
                    }
                  >
                    {sqlRiskPolicies.map((policy) => (
                      <option
                        key={policy}
                        value={policy}
                        disabled={
                          policy === "off" && form.environment === "production"
                        }
                      >
                        {t(`connection.sqlRiskPolicy.${policy}`)}
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
                      updateSslMode(
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

                <Field
                  label={t("connection.clientCertificate")}
                  hint={t("connection.clientCertificateHint")}
                  error={
                    fieldErrors.clientCertificatePath &&
                    t(fieldErrors.clientCertificatePath)
                  }
                >
                  <input
                    disabled={!usesTls}
                    value={form.clientCertificatePath}
                    onChange={(event) =>
                      updateField("clientCertificatePath", event.target.value)
                    }
                    placeholder="/path/to/client.crt"
                    spellCheck={false}
                  />
                </Field>

                <Field
                  label={t("connection.clientKey")}
                  hint={t("connection.clientKeyHint")}
                  error={fieldErrors.clientKeyPath && t(fieldErrors.clientKeyPath)}
                >
                  <input
                    disabled={!usesTls}
                    value={form.clientKeyPath}
                    onChange={(event) =>
                      updateField("clientKeyPath", event.target.value)
                    }
                    placeholder="/path/to/client.key"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </fieldset>

            <fieldset>
              <legend>{t("connection.section.ssh")}</legend>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={form.sshEnabled}
                  onChange={(event) => updateSshEnabled(event.target.checked)}
                />
                <span>{t("connection.sshEnabled")}</span>
              </label>

              {form.sshEnabled ? (
                <div className="ssh-settings">
                  <div className="form-grid">
                    <Field
                      label={t("connection.sshHost")}
                      error={fieldErrors.sshHost && t(fieldErrors.sshHost)}
                    >
                      <input
                        value={form.sshHost}
                        onChange={(event) => updateField("sshHost", event.target.value)}
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label={t("connection.sshPort")}
                      error={fieldErrors.sshPort && t(fieldErrors.sshPort)}
                    >
                      <input
                        inputMode="numeric"
                        value={form.sshPort}
                        onChange={(event) => updateField("sshPort", Number(event.target.value))}
                      />
                    </Field>
                    <Field
                      label={t("connection.sshUsername")}
                      error={fieldErrors.sshUsername && t(fieldErrors.sshUsername)}
                    >
                      <input
                        value={form.sshUsername}
                        onChange={(event) => updateField("sshUsername", event.target.value)}
                        autoComplete="username"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label={t("connection.sshAuthentication")}>
                      <select
                        value={form.sshAuthentication}
                        onChange={(event) =>
                          updateSshAuthentication(
                            event.target.value as ConnectionFormValue["sshAuthentication"],
                          )
                        }
                      >
                        {sshAuthentications.map((authentication) => (
                          <option key={authentication} value={authentication}>
                            {t(`ssh.authentication.${authentication}`)}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {form.sshAuthentication === "password" ? (
                      <Field
                        className="form-field-wide"
                        label={t("connection.sshPassword")}
                        error={fieldErrors.sshPassword && t(fieldErrors.sshPassword)}
                      >
                        <SecretInput
                          value={form.sshPassword}
                          visible={showSshPassword}
                          onChange={(value) => updateField("sshPassword", value)}
                          onToggle={() => setShowSshPassword((visible) => !visible)}
                          showLabel={t("connection.passwordShow")}
                          hideLabel={t("connection.passwordHide")}
                          autoComplete="current-password"
                        />
                      </Field>
                    ) : (
                      <>
                        <Field
                          label={t("connection.sshPrivateKey")}
                          error={
                            fieldErrors.sshPrivateKeyPath &&
                            t(fieldErrors.sshPrivateKeyPath)
                          }
                        >
                          <input
                            value={form.sshPrivateKeyPath}
                            onChange={(event) =>
                              updateField("sshPrivateKeyPath", event.target.value)
                            }
                            placeholder="~/.ssh/id_ed25519"
                            spellCheck={false}
                          />
                        </Field>
                        <Field label={t("connection.sshPrivateKeyPassphrase")}>
                          <SecretInput
                            value={form.sshPrivateKeyPassphrase}
                            visible={showSshPassphrase}
                            onChange={(value) => updateField("sshPrivateKeyPassphrase", value)}
                            onToggle={() => setShowSshPassphrase((visible) => !visible)}
                            showLabel={t("connection.passwordShow")}
                            hideLabel={t("connection.passwordHide")}
                            autoComplete="off"
                          />
                        </Field>
                      </>
                    )}

                    <Field
                      className="form-field-wide"
                      label={t("connection.knownHosts")}
                      hint={t("connection.knownHostsHint")}
                    >
                      <input
                        value={form.sshKnownHostsPath}
                        onChange={(event) =>
                          updateField("sshKnownHostsPath", event.target.value)
                        }
                        placeholder="~/.ssh/known_hosts"
                        spellCheck={false}
                      />
                    </Field>
                  </div>

                  <div className="jump-host-settings">
                    <label className="toggle-control">
                      <input
                        type="checkbox"
                        checked={form.jumpHostEnabled}
                        onChange={(event) => updateJumpHostEnabled(event.target.checked)}
                      />
                      <span>{t("connection.jumpHostEnabled")}</span>
                    </label>

                    {form.jumpHostEnabled ? (
                      <div className="form-grid">
                        <Field
                          label={t("connection.jumpHost")}
                          error={fieldErrors.jumpHost && t(fieldErrors.jumpHost)}
                        >
                          <input
                            value={form.jumpHost}
                            onChange={(event) => updateField("jumpHost", event.target.value)}
                            spellCheck={false}
                          />
                        </Field>
                        <Field
                          label={t("connection.jumpPort")}
                          error={fieldErrors.jumpPort && t(fieldErrors.jumpPort)}
                        >
                          <input
                            inputMode="numeric"
                            value={form.jumpPort}
                            onChange={(event) =>
                              updateField("jumpPort", Number(event.target.value))
                            }
                          />
                        </Field>
                        <Field
                          label={t("connection.jumpUsername")}
                          error={fieldErrors.jumpUsername && t(fieldErrors.jumpUsername)}
                        >
                          <input
                            value={form.jumpUsername}
                            onChange={(event) =>
                              updateField("jumpUsername", event.target.value)
                            }
                            autoComplete="username"
                            spellCheck={false}
                          />
                        </Field>
                        <Field label={t("connection.jumpAuthentication")}>
                          <select
                            value={form.jumpAuthentication}
                            onChange={(event) =>
                              updateJumpAuthentication(
                                event.target.value as ConnectionFormValue["jumpAuthentication"],
                              )
                            }
                          >
                            {sshAuthentications.map((authentication) => (
                              <option key={authentication} value={authentication}>
                                {t(`ssh.authentication.${authentication}`)}
                              </option>
                            ))}
                          </select>
                        </Field>

                        {form.jumpAuthentication === "password" ? (
                          <Field
                            className="form-field-wide"
                            label={t("connection.jumpPassword")}
                            error={fieldErrors.jumpPassword && t(fieldErrors.jumpPassword)}
                          >
                            <SecretInput
                              value={form.jumpPassword}
                              visible={showJumpPassword}
                              onChange={(value) => updateField("jumpPassword", value)}
                              onToggle={() => setShowJumpPassword((visible) => !visible)}
                              showLabel={t("connection.passwordShow")}
                              hideLabel={t("connection.passwordHide")}
                              autoComplete="current-password"
                            />
                          </Field>
                        ) : (
                          <>
                            <Field
                              label={t("connection.jumpPrivateKey")}
                              error={
                                fieldErrors.jumpPrivateKeyPath &&
                                t(fieldErrors.jumpPrivateKeyPath)
                              }
                            >
                              <input
                                value={form.jumpPrivateKeyPath}
                                onChange={(event) =>
                                  updateField("jumpPrivateKeyPath", event.target.value)
                                }
                                placeholder="~/.ssh/id_ed25519"
                                spellCheck={false}
                              />
                            </Field>
                            <Field label={t("connection.jumpPrivateKeyPassphrase")}>
                              <SecretInput
                                value={form.jumpPrivateKeyPassphrase}
                                visible={showJumpPassphrase}
                                onChange={(value) =>
                                  updateField("jumpPrivateKeyPassphrase", value)
                                }
                                onToggle={() =>
                                  setShowJumpPassphrase((visible) => !visible)
                                }
                                showLabel={t("connection.passwordShow")}
                                hideLabel={t("connection.passwordHide")}
                                autoComplete="off"
                              />
                            </Field>
                          </>
                        )}

                        <Field
                          className="form-field-wide"
                          label={t("connection.jumpKnownHosts")}
                          hint={t("connection.knownHostsHint")}
                        >
                          <input
                            value={form.jumpKnownHostsPath}
                            onChange={(event) =>
                              updateField("jumpKnownHostsPath", event.target.value)
                            }
                            placeholder="~/.ssh/known_hosts"
                            spellCheck={false}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
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

interface SecretInputProps {
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  autoComplete: string;
}

function SecretInput({
  value,
  visible,
  onChange,
  onToggle,
  showLabel,
  hideLabel,
  autoComplete,
}: SecretInputProps) {
  return (
    <div className="password-input">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
      />
      <IconButton
        type="button"
        label={visible ? hideLabel : showLabel}
        onClick={onToggle}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </IconButton>
    </div>
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
