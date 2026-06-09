/**
 * Parse a user-typed dollar string into INTEGER CENTS.
 *
 * Accepts: "3", "3.5", "3.50", "12". Rejects negatives, scientific notation,
 * letters, more than 2 decimals. Returns null on garbage. Used by the
 * wishlist form to convert UI dollar input → the integer-cents money
 * representation the service stores (ADR-0009).
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d+(?:\.\d{0,2})?$/.test(trimmed)) return null;
  const [dollars, frac = ''] = trimmed.split('.');
  const cents =
    Number.parseInt(dollars!, 10) * 100 + Number.parseInt(frac.padEnd(2, '0') || '0', 10);
  if (!Number.isFinite(cents) || cents < 0) return null;
  return cents;
}
