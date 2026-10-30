/** Blank means unset; undefined distinguishes invalid input from an unset threshold. */
export function parseJevThreshold(text: string): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  const match = /^[-+]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:e([-+]?\d+))?$/i.exec(value);
  if (!match) return undefined;
  const number = Number(value);
  const fractionalDigits = (match[1] ?? match[2] ?? "").length;
  const exponent = Number(match[3] ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1 || fractionalDigits - exponent > 6)
    return undefined;
  return number === 0 ? 0 : number;
}

export function jevThresholdError(text: string): string | null {
  return parseJevThreshold(text) === undefined
    ? "0 이상 1 이하의 수를 소수점 여섯 자리까지 입력하세요."
    : null;
}
