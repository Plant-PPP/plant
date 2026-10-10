import { z } from "zod";

import { Constants } from "./db/generated/database.types";

export const currencySchema = z.enum(Constants.public.Enums.currency);
export type Currency = z.infer<typeof currencySchema>;

// Amounts travel as decimal strings so no layer rounds them through a float.
// Postgres stores them as numeric(20, 8): up to DECIMAL_INTEGER_DIGITS integer
// digits and DECIMAL_SCALE_DIGITS decimals. Trailing zeros are allowed ("1.5"
// and "1.50"; Postgres returns the column padded to 8 decimals), so amounts are
// compared as decimals, never as strings.
const DECIMAL_INTEGER_DIGITS = 12;
const DECIMAL_SCALE_DIGITS = 8;
const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_SCALE_DIGITS);
const DECIMAL_PATTERN = new RegExp(
  `^-?(0|[1-9]\\d{0,${DECIMAL_INTEGER_DIGITS - 1}})(\\.\\d{1,${DECIMAL_SCALE_DIGITS}})?$`,
);

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN, "Must be a decimal number, e.g. 1234.56")
  .refine((value) => !/^-0(\.0+)?$/.test(value), "Use 0 instead of -0");

export const positiveDecimalSchema = decimalStringSchema.refine(
  (value) => !/^(-|0(\.0+)?$)/.test(value),
  "Must be greater than 0",
);

// A decimal string as an integer count of 10^-DECIMAL_SCALE_DIGITS units,
// exact for every string DECIMAL_PATTERN matches. Throws a RangeError on
// anything else.
export function toScaled(decimal: string): bigint {
  if (!DECIMAL_PATTERN.test(decimal)) {
    throw new RangeError("Expected a decimal string");
  }
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (
    negative ? decimal.slice(1) : decimal
  ).split(".");
  const scaled =
    BigInt(whole) * DECIMAL_SCALE +
    BigInt(fraction.padEnd(DECIMAL_SCALE_DIGITS, "0"));
  return negative ? -scaled : scaled;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

// The one rounding rule for money: half away from zero.
export function divideRounded(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError("Division by zero");
  const quotient = (abs(n) * 2n + abs(d)) / (abs(d) * 2n);
  return n < 0n !== d < 0n ? -quotient : quotient;
}

// Units of 10^-DECIMAL_SCALE_DIGITS as the shortest decimal string. It has no
// digit cap: a value beyond DECIMAL_INTEGER_DIGITS integer digits formats fine
// but does not fit numeric(20, 8).
export function fromScaled(units: bigint): string {
  const whole = abs(units) / DECIMAL_SCALE;
  const fraction = (abs(units) % DECIMAL_SCALE)
    .toString()
    .padStart(DECIMAL_SCALE_DIGITS, "0")
    .replace(/0+$/, "");
  const text = fraction === "" ? whole.toString() : `${whole}.${fraction}`;
  return units < 0n ? `-${text}` : text;
}

// An exact fraction, kept reduced with a positive denominator, so equal values
// are equal pairs.
export type Exact = { readonly n: bigint; readonly d: bigint };

function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [abs(a), abs(b)];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function reduced(n: bigint, d: bigint): Exact {
  if (d === 0n) throw new RangeError("Division by zero");
  const sign = d < 0n ? -1n : 1n;
  const divisor = gcd(n, d);
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

export const exactOf = (decimal: string): Exact =>
  reduced(toScaled(decimal), DECIMAL_SCALE);

export const times = (a: Exact, b: Exact): Exact =>
  reduced(a.n * b.n, a.d * b.d);

export const over = (a: Exact, b: Exact): Exact =>
  reduced(a.n * b.d, a.d * b.n);

export const plus = (...xs: Exact[]): Exact =>
  xs.reduce((sum, x) => reduced(sum.n * x.d + x.n * sum.d, sum.d * x.d), {
    n: 0n,
    d: 1n,
  });

export function compareExact(a: Exact, b: Exact): number {
  const difference = a.n * b.d - b.n * a.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function compareDecimals(a: string, b: string): number {
  const difference = toScaled(a) - toScaled(b);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

// A refinement runs even when an earlier check or field failed; skip it then,
// since its inputs may be invalid (compareDecimals throws on one).
export const fieldsPassed = (payload: { issues: readonly unknown[] }) =>
  payload.issues.length === 0;

// x rounded half away from zero (divideRounded) to `digits` decimals, 0 to
// DECIMAL_SCALE_DIGITS.
export function roundedTo(x: Exact, digits: number): Exact {
  if (
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > DECIMAL_SCALE_DIGITS
  ) {
    throw new RangeError(`Expected 0 to ${DECIMAL_SCALE_DIGITS} digits`);
  }
  const unit = 10n ** BigInt(digits);
  return reduced(divideRounded(x.n * unit, x.d), unit);
}

export function toDecimal(x: Exact, digits: number): string {
  const rounded = roundedTo(x, digits);
  return fromScaled((rounded.n * DECIMAL_SCALE) / rounded.d);
}

export const moneySchema = z.object({
  amount: decimalStringSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export type ExactMoney = { amount: Exact; currency: Currency };
