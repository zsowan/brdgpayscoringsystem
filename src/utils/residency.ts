import type { CustomerRecord } from '../models/customer';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Years of residency, based purely on elapsed time since the start date — never
 * on nationality. Rounded to one decimal (e.g. 8.6) to match the demo's display format.
 */
export function computeResidencyDurationYears(startDate: unknown): number | null {
  if (startDate === null || startDate === undefined || startDate === '') return null;
  const start = new Date(String(startDate));
  if (Number.isNaN(start.getTime())) return null;
  const diffDays = (Date.now() - start.getTime()) / MS_PER_DAY;
  return Math.round((diffDays / 365.25) * 10) / 10;
}

/** Months remaining until residency expiry — negative once expired. */
export function computeResidencyRemainingMonths(expiryDate: unknown): number | null {
  if (expiryDate === null || expiryDate === undefined || expiryDate === '') return null;
  const expiry = new Date(String(expiryDate));
  if (Number.isNaN(expiry.getTime())) return null;
  const diffDays = (expiry.getTime() - Date.now()) / MS_PER_DAY;
  return Math.round(diffDays / 30.4375);
}

/**
 * Demo stability classification driven only by residency duration and status —
 * never by nationality. Two residents with the same duration always land in the
 * same category regardless of which country they're from.
 */
export function deriveResidencyStabilityCategory(residencyStatus: unknown, durationYears: number | null): string {
  if (residencyStatus === 'CITIZEN') return 'citizen_or_permanent';
  if (durationYears === null) return 'unspecified';
  if (durationYears >= 10) return 'resident_10y_plus';
  if (durationYears >= 5) return 'resident_5_10y';
  if (durationYears >= 3) return 'resident_3_5y';
  return 'resident_under_3y';
}

export interface ResidencyDerived {
  residency_duration_years: number | null;
  residency_remaining_months: number | null;
  residency_stability_category: string;
}

export function deriveResidencyFields(data: CustomerRecord): ResidencyDerived {
  const residency_duration_years = computeResidencyDurationYears(data.residency_start_date);
  const residency_remaining_months = computeResidencyRemainingMonths(data.residency_expiry_date);
  const residency_stability_category = deriveResidencyStabilityCategory(data.residency_status, residency_duration_years);
  return { residency_duration_years, residency_remaining_months, residency_stability_category };
}

export const RESIDENCY_STATUS_LABELS: Record<string, string> = {
  CITIZEN: 'Citizen',
  RESIDENT: 'Resident',
  OTHER: 'Other',
};

export const RESIDENCY_STABILITY_LABELS: Record<string, string> = {
  citizen_or_permanent: 'Citizen / Permanent',
  resident_10y_plus: 'Resident 10+ years',
  resident_5_10y: 'Resident 5–10 years',
  resident_3_5y: 'Resident 3–5 years',
  resident_under_3y: 'Resident under 3 years',
  unspecified: 'Unspecified',
};

export const RESIDENCY_STABILITY_REASONS: Record<string, string> = {
  citizen_or_permanent: 'Citizen or permanent status',
  resident_10y_plus: 'Long-standing verified residency history',
  resident_5_10y: 'Stable verified residency history',
  resident_3_5y: 'Moderate verified residency history',
  resident_under_3y: 'Limited verified residency history',
  unspecified: 'Residency start date not provided',
};
