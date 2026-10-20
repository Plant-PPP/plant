// An amount field's text as it is typed or pasted, cut to what can still
// become an amount: digits, one decimal comma, dots grouping before it, never
// a separator first or two in a row. "30117,=..2ab" is "30117,2".
export function typedAmount(text: string): string {
  let kept = "";
  for (const char of text) {
    const last = kept.at(-1);
    const afterDigit = last !== undefined && /\d/.test(last);
    if (/\d/.test(char)) kept += char;
    else if (char === "," && afterDigit && !kept.includes(",")) kept += char;
    else if (char === "." && afterDigit && !kept.includes(",")) kept += char;
  }
  return kept;
}
