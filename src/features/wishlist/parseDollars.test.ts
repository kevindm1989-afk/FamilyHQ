/**
 * parseDollarsToCents — pure UI helper. INTEGER CENTS guard (ADR-0009).
 */
import { describe, expect, it } from 'vitest';
import { parseDollarsToCents } from './parseDollars';

describe('parseDollarsToCents', () => {
  it('parses whole-dollar input as cents', () => {
    expect(parseDollarsToCents('12')).toBe(1200);
    expect(parseDollarsToCents('1')).toBe(100);
    expect(parseDollarsToCents('0')).toBe(0);
  });

  it('parses two-decimal input as cents', () => {
    expect(parseDollarsToCents('3.50')).toBe(350);
    expect(parseDollarsToCents('38.50')).toBe(3850);
    expect(parseDollarsToCents('0.05')).toBe(5);
  });

  it('parses one-decimal input as cents (pads to two decimals)', () => {
    expect(parseDollarsToCents('3.5')).toBe(350);
    expect(parseDollarsToCents('0.5')).toBe(50);
  });

  it('trims surrounding whitespace', () => {
    expect(parseDollarsToCents('  3.50  ')).toBe(350);
  });

  it('returns null for empty / whitespace input', () => {
    expect(parseDollarsToCents('')).toBeNull();
    expect(parseDollarsToCents('   ')).toBeNull();
  });

  it('returns null for negative input', () => {
    expect(parseDollarsToCents('-3.50')).toBeNull();
    expect(parseDollarsToCents('-1')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('$3.50')).toBeNull();
    expect(parseDollarsToCents('3.50abc')).toBeNull();
  });

  it('returns null for more than 2 decimals (no quarter-cent drift)', () => {
    expect(parseDollarsToCents('3.501')).toBeNull();
    expect(parseDollarsToCents('3.999')).toBeNull();
  });

  it('returns null for scientific notation', () => {
    expect(parseDollarsToCents('1e2')).toBeNull();
  });
});
