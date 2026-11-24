import type { CustomerRecord } from '../models/customer';

/**
 * Debt-to-Income is always derived from monthly_debt_obligations ÷ monthly_income —
 * never taken as a raw CINET value directly, and never from Active Loans count.
 * Returns null (unavailable) rather than Infinity/NaN when income is missing or zero,
 * or when obligations themselves are unavailable (e.g. a CINET outage).
 */
export function computeDebtToIncome(customer: CustomerRecord): number | null {
  const obligations = customer.monthly_debt_obligations;
  if (obligations === null || obligations === undefined || obligations === '') return null;

  const obligationsNum = Number(obligations);
  if (!Number.isFinite(obligationsNum)) return null;

  const income = Number(customer.monthly_income);
  if (!Number.isFinite(income) || income <= 0) return null;

  const dti = obligationsNum / income;
  if (!Number.isFinite(dti)) return null;

  return Math.round(dti * 1000) / 1000;
}

export function formatDtiPercent(dti: number | null | undefined): string {
  if (dti === null || dti === undefined || Number.isNaN(dti)) return '—';
  return `${Math.round(dti * 100)}%`;
}
