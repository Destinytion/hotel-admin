/*
  Amounts in words the Indian way, as printed on receipts and cheques:
  1,25,000.50 -> "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only".
  Plain TypeScript with no imports, so tests can load it directly.
*/

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", belowHundred(n % 100)].filter(Boolean).join(" ");
}

/** A whole number in words: crore, lakh, thousand, hundred. */
export function numberInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    belowThousand(n),
  ]
    .filter(Boolean)
    .join(" ");
}

export function amountInWords(amount: number): string {
  // Work in whole paise so 0.1 + 0.2 style rounding cannot creep in.
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  const words = paise
    ? `Rupees ${numberInWords(rupees)} and ${belowHundred(paise)} Paise Only`
    : `Rupees ${numberInWords(rupees)} Only`;
  return amount < 0 ? `Minus ${words}` : words;
}
