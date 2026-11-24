import type { CustomerRecord } from '../models/customer';
import type { CinetOpenAccount } from '../models/cinet';

function isUnset(value: unknown): boolean {
  return value === null || value === undefined;
}

function isPositive(value: unknown): boolean {
  if (isUnset(value) || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * BRDG Playground derivation — NOT a CINET-defined field, and not a claim of
 * formal "default": overdue payments / DPD indicate payment delinquency, and any
 * production default definition would need its own confirmed business/regulatory
 * threshold. Returns null (unavailable) when the underlying CINET data itself is
 * missing — never coerces that into false — and never treats a genuine 0 or
 * false value as missing.
 */
export function deriveCurrentDelinquency(customer: CustomerRecord): boolean | null {
  const overdueAmount = customer.total_overdue_bnpl_amount;
  if (isUnset(overdueAmount)) return null;

  if (isPositive(overdueAmount)) return true;

  const openAccounts = Array.isArray(customer.cinet_open_accounts)
    ? (customer.cinet_open_accounts as CinetOpenAccount[])
    : [];

  for (const account of openAccounts) {
    if (isPositive(account.overdueBalance)) return true;
    if (isPositive(account.paymentsOutstanding)) return true;
    if (isPositive(account.dpd)) return true;
  }

  return false;
}

export const CURRENT_DELINQUENCY_LABELS: Record<string, string> = {
  true: 'Current Delinquency Detected',
  false: 'No Current Delinquency',
};

export function formatCurrentDelinquency(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return value ? 'Current Delinquency Detected' : 'No Current Delinquency';
}
