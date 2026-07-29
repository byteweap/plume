import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SqlEditor, type SqlEditorController } from "./SqlEditor";

describe("SqlEditor", () => {
  it("exposes string-based value and selection operations", () => {
    const onChange = vi.fn();
    const controller = createRef<SqlEditorController>();
    const { rerender } = render(
      <SqlEditor
        ref={controller}
        label="SQL query workspace"
        value="select 1;"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: "SQL query workspace" })).toBeVisible();
    expect(controller.current?.getValue()).toBe("select 1;");

    act(() => controller.current?.replaceSelection("explain "));
    expect(onChange).toHaveBeenLastCalledWith("explain select 1;");

    rerender(
      <SqlEditor
        ref={controller}
        label="SQL editor"
        value="select now();"
        onChange={onChange}
      />,
    );
    expect(controller.current?.getValue()).toBe("select now();");
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toBeVisible();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
