import { expect, test } from "vitest";
import { formatBytes } from "./format";

test("formatBytes", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  expect(formatBytes(3 * 1024 ** 3)).toBe("3 GB");
});
