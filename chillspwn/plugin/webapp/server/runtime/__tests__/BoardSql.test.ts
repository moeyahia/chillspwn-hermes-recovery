import { describe, expect, test } from "bun:test";
import { executeBoardSqlWrite, quoteBoardSqlText } from "../BoardSql";

describe("legacy board SQL transport", () => {
  test("escapes hostile SQL quotes and strips NUL", () => {
    expect(quoteBoardSqlText("x'; DROP TABLE tasks; --\0")).toBe("x''; DROP TABLE tasks; --");
  });

  test("passes hostile shell syntax as one sqlite argv value without a shell", () => {
    const calls: any[] = [];
    const sql = `UPDATE tasks SET title='${quoteBoardSqlText(`$(touch /tmp/nope) \\"; echo pwned; x'`)}'`;
    executeBoardSqlWrite("/tmp/board with spaces.db", sql, ((file: string, args: readonly string[], options: any) => {
      calls.push({ file, args: [...args], options });
      return "";
    }) as any);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("sqlite3");
    expect(calls[0].args).toEqual(["-cmd", ".timeout 5000", "/tmp/board with spaces.db", sql]);
    expect(calls[0].options.shell).toBeUndefined();
  });
});
