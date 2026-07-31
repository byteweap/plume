import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useI18n } from "./I18nContext";
import { I18nProvider } from "./I18nProvider";

function LocaleProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <output data-testid="locale">{locale}</output>
      <p>{t("app.tagline")}</p>
      <button type="button" onClick={() => setLocale("zh-CN")}>
        中文
      </button>
      <button type="button" onClick={() => setLocale("en-US")}>
        EN
      </button>
    </div>
  );
}

describe("I18nProvider", () => {
  afterEach(() => window.localStorage.clear());

  it("restores and persists the selected locale", () => {
    window.localStorage.setItem("plume.locale", "zh-CN");
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale")).toHaveTextContent("zh-CN");
    expect(screen.getByText("轻盈的 PostgreSQL 工作台")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByTestId("locale")).toHaveTextContent("en-US");
    expect(screen.getByText("A lightweight PostgreSQL workspace")).toBeVisible();
    expect(window.localStorage.getItem("plume.locale")).toBe("en-US");
  });

  it("falls back to a supported locale for unknown stored values", () => {
    window.localStorage.setItem("plume.locale", "fr-FR");
    render(
      <I18nProvider>
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(["zh-CN", "en-US"]).toContain(screen.getByTestId("locale").textContent);
  });
});
