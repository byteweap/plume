import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { QueryHistory } from "./queryHistory";
import { QueryHistoryPanel } from "./QueryHistoryPanel";

const entry: QueryHistory = {
  id: "history-1",
  profileId: "profile-1",
  database: "postgres",
  schema: "public",
  sql: "select * from users;",
  durationMs: 42,
  resultStatus: "succeeded",
  executedAt: 1,
};

describe("QueryHistoryPanel", () => {
  it("searches, opens, copies, refreshes, and clears entries", () => {
    const onSearchChange = vi.fn();
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    const onRefresh = vi.fn();
    const onClear = vi.fn();

    render(
      <I18nProvider>
        <QueryHistoryPanel
          entries={[entry]}
          search=""
          onSearchChange={onSearchChange}
          onRefresh={onRefresh}
          onClear={onClear}
          onOpen={onOpen}
          onCopy={onCopy}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
      target: { value: "users" },
    });
    fireEvent.click(screen.getByTitle("select * from users;"));
    fireEvent.click(screen.getByRole("button", { name: "Copy SQL" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));

    expect(onSearchChange).toHaveBeenCalledWith("users");
    expect(onOpen).toHaveBeenCalledWith(entry);
    expect(onCopy).toHaveBeenCalledWith(entry);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
