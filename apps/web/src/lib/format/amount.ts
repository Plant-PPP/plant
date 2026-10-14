import { DENOMINATORS, type Denominator, isDenominator } from "@plant/core";
import {
  type Currency,
  compareExact,
  decimalStringSchema,
  exactOf,
  over,
  times,
  toDecimal,
} from "@plant/shared";

type Unit = Denominator | Currency;

// How each unit is written around its number.
const AFFIXES = {
  ars: { prefix: "$ ", suffix: "" },
  usd_mep: { prefix: "US$ ", suffix: "" },
  usd_ccl: { prefix: "US$ ", suffix: "" },
  usd_official: { prefix: "US$ ", suffix: "" },
  btc: { prefix: "", suffix: " BTC" },
  ARS: { prefix: "$ ", suffix: "" },
  USD: { prefix: "US$ ", suffix: "" },
} satisfies Record<Unit, { prefix: string; suffix: string }>;

// A currency's symbol, as its amounts start: $ or US$.
export const currencySymbol = (currency: Currency): string =>
  AFFIXES[currency].prefix.trim();

const CURRENCY_DIGITS = 2;
const QUANTITY_DIGITS = 8;

const digitsOf = (unit: Unit): number =>
  isDenominator(unit) ? DENOMINATORS[unit].scale : CURRENCY_DIGITS;

// An amount as it shows in `unit`, rounded to the digits the unit shows, so
// its sign is the sign a reader sees.
export const shownAmount = (decimal: string, unit: Unit): string =>
  toDecimal(exactOf(decimal), digitsOf(unit));

// The sign an amount shows with in `unit`: one that rounds to zero has none.
export const shownSign = (decimal: string, unit: Unit): -1 | 0 | 1 => {
  const { n } = exactOf(shownAmount(decimal, unit));
  return n < 0n ? -1 : n > 0n ? 1 : 0;
};

// A figure with "+" when the decimal it shows is above zero.
export const signed = (text: string, shown: string): string =>
  exactOf(shown).n > 0n ? `+${text}` : text;

// A decimal string in es-AR digits: "." groups thousands, "," marks decimals.
// Rounded half away from zero only when it has more decimals than `digits`;
// padded to `digits` unless `trim`; the thousands go ungrouped unless `group`.
function esAr(
  decimal: string,
  digits: number,
  { trim = false, group = true } = {},
): string {
  const fraction = decimal.split(".")[1] ?? "";
  const rounded =
    fraction.length > digits ? toDecimal(exactOf(decimal), digits) : decimal;
  const negative = rounded.startsWith("-");
  const [whole = "0", decimals = ""] = (
    negative ? rounded.slice(1) : rounded
  ).split(".");
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : whole;
  const shown = trim
    ? decimals.replace(/0+$/, "")
    : decimals.padEnd(digits, "0");
  return `${negative ? "-" : ""}${grouped}${shown ? `,${shown}` : ""}`;
}

// An amount in a unit as es-AR shows it: $ 1.234.567,89, US$ 12.345,67,
// 0,50000000 BTC; a negative as -$ 1.234,50.
export function formatAmount(decimal: string, unit: Unit): string {
  const { prefix, suffix } = AFFIXES[unit];
  const text = esAr(decimal, digitsOf(unit));
  return text.startsWith("-")
    ? `-${prefix}${text.slice(1)}${suffix}`
    : `${prefix}${text}${suffix}`;
}

// The decimals a price under one unit keeps, so a coin worth a fraction of a
// cent is not 0,00.
export const SMALL_PRICE_DIGITS = 8;

// A unit price: an amount, with up to SMALL_PRICE_DIGITS decimals when it is
// under one unit (US$ 0,0004), trailing zeros past the unit's dropped.
export function formatPrice(decimal: string, unit: Unit): string {
  const digits = digitsOf(unit);
  if (
    compareExact(exactOf(decimal), exactOf("1")) >= 0 ||
    digits >= SMALL_PRICE_DIGITS
  ) {
    return formatAmount(decimal, unit);
  }
  const { prefix, suffix } = AFFIXES[unit];
  const [whole = "0", decimals = ""] = esAr(decimal, SMALL_PRICE_DIGITS, {
    trim: true,
  }).split(",");
  return `${prefix}${whole},${decimals.padEnd(digits, "0")}${suffix}`;
}

// A share in percent, to one decimal: 12,5 %.
export function formatShare(decimal: string): string {
  return `${esAr(decimal, 1)} %`;
}

// A percent as typed, up to two decimals and none it does not need: 10 %,
// 10,05 %, 0,04 %.
export function formatPercent(decimal: string): string {
  return `${esAr(decimal, 2, { trim: true })} %`;
}

// A quantity held, up to 8 decimals, trailing zeros dropped: 0,5 or 1.234.
export function formatQuantity(decimal: string): string {
  return esAr(decimal, QUANTITY_DIGITS, { trim: true });
}

// An amount as a form field starts with it: ungrouped, so it reads back the
// same (1234,5).
export function amountInput(decimal: string): string {
  return esAr(decimal, QUANTITY_DIGITS, { trim: true, group: false });
}

const GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/;
// 1.234 is a thousand in es-AR and one and a fraction with a dot keypad.
const AMBIGUOUS = /^[1-9]\d{0,2}\.\d{3}$/;

// What a user typed as an amount, as a decimal string, or null: es-AR
// (1.234.567,89) or plain (1234567.89). Dots group thousands only beside a
// decimal comma or when there are several; a lone dot before three digits is
// refused (1.234 reads two ways). A spreadsheet's cells read 1.234 as a
// thousand (@plant/sources/spreadsheet's parseSheetDecimal).
export function parseAmountInput(text: string): string | null {
  const typed = text.trim().replace(/\s/g, "");
  if (typed === "") return null;
  let plain: string;
  if (typed.includes(",")) {
    const [whole = "", fraction, extra] = typed.split(",");
    if (extra !== undefined) return null;
    if (whole.includes(".") && !GROUPED.test(whole)) return null;
    plain = `${whole.replace(/\./g, "")}.${fraction}`;
  } else {
    if (AMBIGUOUS.test(typed)) return null;
    plain = GROUPED.test(typed) ? typed.replace(/\./g, "") : typed;
  }
  return decimalStringSchema.safeParse(plain).success && !plain.startsWith("-")
    ? plain
    : null;
}

const HUNDRED = exactOf("100");
// annual_rate is numeric(20, 8).
const FRACTION_DIGITS = 8;

// A fraction as a percent to one decimal, for formatShare: "0.0523" is "5.2".
export const percentOf = (fraction: string): string =>
  toDecimal(times(exactOf(fraction), HUNDRED), 1);

// A fraction as a percent to show: "0.0523" is "5,2 %".
export const formatFraction = (fraction: string): string =>
  formatShare(percentOf(fraction));

// A fraction as a form field starts with it, in percent: "0.355" is 35,5.
export function percentInput(fraction: string): string {
  return amountInput(toDecimal(times(exactOf(fraction), HUNDRED), 6));
}

// A typed percent as the fraction stored, or null: "35,5" is "0.355". A
// percent whose fraction needs more decimals than the column keeps is refused,
// never rounded.
export function percentToFraction(text: string): string | null {
  const percent = parseAmountInput(text.trim().replace(/%$/, ""));
  if (percent === null) return null;
  const fraction = over(exactOf(percent), HUNDRED);
  const stored = toDecimal(fraction, FRACTION_DIGITS);
  return compareExact(exactOf(stored), fraction) === 0 ? stored : null;
}
