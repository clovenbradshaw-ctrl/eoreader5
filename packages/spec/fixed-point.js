const DECIMAL_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function assertCanonicalDecimal(value) {
  if (typeof value !== "string" || !DECIMAL_RE.test(value)) {
    throw new TypeError("expected canonical decimal string");
  }
  return value;
}

export function toFixedPoint(value, scale) {
  assertCanonicalDecimal(value);
  const sign = value.startsWith("-") ? -1n : 1n;
  const unsigned = sign < 0 ? value.slice(1) : value;
  const [whole, frac = ""] = unsigned.split(".");
  if (frac.length > scale) throw new RangeError("decimal has more places than scale");
  return sign * (BigInt(whole) * 10n ** BigInt(scale) + BigInt((frac.padEnd(scale, "0") || "0")));
}

export function fromFixedPoint(value, scale) {
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}
