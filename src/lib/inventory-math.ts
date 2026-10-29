// PostgreSQL stores quantity at scale 2 and average unit cost at scale 4.
// Keep their product and sum at scale 6 so values are never rounded through binary floats.
const integerFormat = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 0 });

export function scaledInteger(value: string, scale: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > scale) throw new Error("Invalid fixed-scale inventory decimal");
  const digits = `${match[2]}${(match[3] ?? "").padEnd(scale, "0")}`;
  const integer = BigInt(digits);
  return match[1] ? -integer : integer;
}

export function stockValueScaled(quantity: string, unitCost: string): bigint {
  return scaledInteger(quantity, 2) * scaledInteger(unitCost, 4);
}

/** Format a scaled integer to at most two decimals, rounding half away from zero. */
export function formatInventoryDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  let absolute = negative ? -value : value;
  if (scale > 2) {
    const divisor = 10n ** BigInt(scale - 2);
    absolute = (absolute + divisor / 2n) / divisor;
  } else if (scale < 2) {
    absolute *= 10n ** BigInt(2 - scale);
  }
  const whole = absolute / 100n;
  const fractional = (absolute % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  const roundedNegative = negative && absolute !== 0n;
  const grouped = roundedNegative ? integerFormat.format(whole === 0n ? -0 : -whole) : integerFormat.format(whole);
  return fractional ? `${grouped}.${fractional}` : grouped;
}
