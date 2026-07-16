import { describe, expect, test } from "bun:test";
import { configuredAbsoluteDirectory } from "../configuredPath";

describe("configuredAbsoluteDirectory", () => {
  test("uses and normalizes the absolute default", () => {
    expect(configuredAbsoluteDirectory("TEST_DIR", undefined, "/opt/chillspwn/report-template/../report-template"))
      .toBe("/opt/chillspwn/report-template");
  });

  test("accepts an absolute configured directory and trims surrounding whitespace", () => {
    expect(configuredAbsoluteDirectory("TEST_DIR", "  /srv/chillspwn/templates  ", "/fallback"))
      .toBe("/srv/chillspwn/templates");
  });

  test("rejects relative, empty, NUL-containing, and filesystem-root values", () => {
    expect(() => configuredAbsoluteDirectory("TEST_DIR", "relative/path", "/fallback"))
      .toThrow("absolute path");
    expect(() => configuredAbsoluteDirectory("TEST_DIR", "   ", "/fallback"))
      .toThrow("must not be empty");
    expect(() => configuredAbsoluteDirectory("TEST_DIR", "/opt/bad\0path", "/fallback"))
      .toThrow("NUL byte");
    expect(() => configuredAbsoluteDirectory("TEST_DIR", "/", "/fallback"))
      .toThrow("filesystem root");
  });
});
