import { describe, expect, it } from "vitest";
import { jevThresholdError, parseJevThreshold } from "./jev";

describe("Jev threshold input", () => {
  it.each(["", "  ", "\n\t"])("keeps %j unset without supplying a default", (text) => {
    expect(parseJevThreshold(text)).toBeNull();
    expect(jevThresholdError(text)).toBeNull();
  });

  it.each([
    ["0", 0], ["1", 1], [".123456", 0.123456], ["0.000001", 0.000001],
    [" 0.75 ", 0.75], ["1e-6", 0.000001], ["1.000000", 1], ["-0", 0],
  ] as const)("accepts configured threshold %s", (text, expected) => {
    expect(parseJevThreshold(text)).toBe(expected);
    expect(jevThresholdError(text)).toBeNull();
  });

  it.each([
    "-0.1", "1.000001", ".1234567", "0.0000001", "1e-7", "1.0000000",
    "NaN", "Infinity", "1e999", "threshold", "0x1", ".", "+", "0.2.3",
  ])("distinguishes invalid input %s from null", (text) => {
    expect(parseJevThreshold(text)).toBeUndefined();
    expect(jevThresholdError(text)).toBeTruthy();
  });
});
