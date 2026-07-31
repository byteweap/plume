import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ConnectionProfile } from "../connections/connection";
import { SqlRiskConfirmationDialog } from "./SqlRiskConfirmationDialog";
import { analyzeSqlRisks } from "./sqlRiskAnalysis";

const profile: ConnectionProfile = {
  id: "profile-1",
  name: "Production primary",
  host: "db.internal",
  port: 5432,
  database: "app",
  username: "operator",
  environment: "production",
  color: "#9b3a3a",
  sslMode: "verify-full",
  favorite: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("SqlRiskConfirmationDialog", () => {
  it("shows database identity and every detected risk before confirmation", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    const onConfirm = vi.fn();
    const sql = "DROP TABLE public.logs; DELETE FROM public.sessions;";

    render(
      <I18nProvider>
        <SqlRiskConfirmationDialog
          context={{ profile, database: "app", schema: "public" }}
          risks={analyzeSqlRisks(sql)}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Confirm dangerous SQL",
    });
    expect(dialog).toHaveTextContent("Production primary");
    expect(dialog).toHaveTextContent("db.internal:5432");
    expect(dialog).toHaveTextContent("app");
    expect(dialog).toHaveTextContent("public");
    expect(dialog).toHaveTextContent("Production");
    expect(dialog).toHaveTextContent("DROP object");
    expect(dialog).toHaveTextContent("DELETE without WHERE");
    expect(dialog).toHaveTextContent("public.logs");
    expect(dialog).toHaveTextContent("public.sessions");

    fireEvent.click(within(dialog).getByRole("button", { name: "Execute anyway" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("defaults focus to cancel and supports both cancellation paths", () => {
    window.localStorage.setItem("plume.locale", "en-US");
    const onCancel = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <SqlRiskConfirmationDialog
          context={{ profile, database: "app", schema: "private" }}
          risks={analyzeSqlRisks("TRUNCATE private.events")}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <I18nProvider>
        <SqlRiskConfirmationDialog
          context={{ profile, database: "app", schema: "private" }}
          risks={analyzeSqlRisks("TRUNCATE private.events")}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dangerous SQL confirmation" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
