import { describe, expect, it } from "vitest";
import { groupDatabaseObjects } from "./databaseTree";

describe("groupDatabaseObjects", () => {
  it("groups objects without changing their order", () => {
    const grouped = groupDatabaseObjects([
      { name: "users", kind: "table" },
      { name: "active_users", kind: "view" },
      { name: "posts", kind: "table" },
    ]);

    expect(grouped.table.map((object) => object.name)).toEqual([
      "users",
      "posts",
    ]);
    expect(grouped.view[0]?.name).toBe("active_users");
    expect(grouped.function).toEqual([]);
    expect(grouped["foreign-table"]).toEqual([]);
    expect(grouped.procedure).toEqual([]);
  });
});
