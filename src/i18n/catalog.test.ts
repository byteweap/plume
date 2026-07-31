import { describe, expect, it } from "vitest";
import { catalogs } from "./catalog";

describe("translation catalogs", () => {
  it("keep both locales complete and aligned", () => {
    const zhKeys = Object.keys(catalogs["zh-CN"]).sort();
    const enKeys = Object.keys(catalogs["en-US"]).sort();
    expect(enKeys).toEqual(zhKeys);

    for (const key of zhKeys) {
      expect(catalogs["zh-CN"][key as keyof typeof catalogs["zh-CN"]]).not.toBe("");
      expect(catalogs["en-US"][key as keyof typeof catalogs["en-US"]]).not.toBe("");
    }
  });

  it("preserves interpolation placeholders across locales", () => {
    for (const key of Object.keys(catalogs["zh-CN"]) as Array<keyof typeof catalogs["zh-CN"]>) {
      const placeholders = (value: string) =>
        [...value.matchAll(/\{[^{}]+\}/g)].map((match) => match[0]).sort();
      expect(placeholders(catalogs["zh-CN"][key])).toEqual(
        placeholders(catalogs["en-US"][key]),
      );
    }
  });
});
