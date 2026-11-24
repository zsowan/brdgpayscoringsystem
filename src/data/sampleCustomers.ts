import type { SampleCustomer } from '../models/customer';
import type { CinetOpenAccount } from '../models/cinet';

function dobForAge(age: number): string {
  const year = new Date().getFullYear() - age;
  return `${year}-06-15`;
}

function cleanAccount(overrides: Partial<CinetOpenAccount> = {}): CinetOpenAccount[] {
  return [{ accountNo: 'DEMO-BASE-1', accountStatus: 'CURRENT', paymentsOutstanding: 0, outstandingBalance: 300, overdueBalance: 0, dpd: 0, ...overrides }];
}

function base(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    civil_id: '000000000000',
    civil_id_status: 'VALID',
    civil_id_expiry_date: '2029-01-01',
    mobile_id_verified: true,
    nationality: 'KW',
    residency_status: 'CITIZEN',
    residency_start_date: null,
    residency_expiry_date: null,
    gender: 'MALE',
    email: 'customer@example.com',
    mobile_number: '+96500000000',
    civil_status: 'SINGLE',
    address_area: 'Salmiya',
    address_governorate: 'Hawalli',
    employment_status: 'EMPLOYED',
    employer_name: 'Sample Employer',
    employer_tier: 'sme',
    employer_sector: 'RETAIL',
    employment_tenure_months: 12,
    monthly_income: 400,
    // CINET Score is optional — every sample defaults to a completed, available check.
    cinet_status: 'AVAILABLE',
    // CINET credit bureau data (CINET BNPL Live Request User Manual concepts) —
    // clean by default: no overdue balance, no outstanding payments, no DPD.
    cinet_score: 600,
    cinet_score_cluster: null,
    cinet_evaluation_month: null,
    total_active_bnpl_accounts: 1,
    total_monthly_bnpl_payment: 80,
    total_overdue_bnpl_amount: 0,
    worst_account_status: 'CURRENT',
    max_outstanding_payments_24m: 0,
    cinet_open_accounts: cleanAccount(),
    // debt_to_income is always derived (never set directly) as obligations ÷ income — 80 / 400 = 20%.
    monthly_debt_obligations: 80,
    ...overrides,
  };
}

export const SAMPLE_CUSTOMERS: SampleCustomer[] = [
  {
    id: 'sample_a',
    label: 'A — Kuwaiti Student',
    description: 'Kuwaiti citizen, age 19 → Student segment. Civil ID Status is Not Applicable (Kuwaiti exemption); Student Nationality gate passes. Scoring uses only Student Allowance, CINET Score, and Existing Debt/Credit Exposure.',
    data: base({
      civil_id: '110203040001', date_of_birth: dobForAge(19), age: 19,
      nationality: 'KW', residency_status: 'CITIZEN',
      employment_status: 'STUDENT', employer_name: 'Part-Time Retail', employer_tier: 'sme', employment_tenure_months: 3,
      monthly_income: 250, student_allowance: 180, cinet_score: 640, monthly_debt_obligations: 0,
      total_overdue_bnpl_amount: 0, worst_account_status: 'CURRENT', cinet_open_accounts: cleanAccount({ accountNo: 'DEMO-A-1' }),
    }),
  },
  {
    id: 'sample_b',
    label: 'B — Kuwaiti Young Adult',
    description: 'Kuwaiti citizen, age 23 → Young Adult segment. Civil ID Status is Not Applicable (Kuwaiti exemption). Nationality participates in scoring at its configured 10% weight (Kuwaiti → 1.00).',
    data: base({
      civil_id: '110203040002', date_of_birth: dobForAge(23), age: 23,
      nationality: 'KW', residency_status: 'CITIZEN',
      employment_status: 'EMPLOYED', employer_tier: 'large_corp', employment_tenure_months: 36,
      monthly_income: 850, cinet_score: 700, monthly_debt_obligations: 200,
    }),
  },
  {
    id: 'sample_c',
    label: 'C — Kuwaiti Established Customer',
    description: 'Kuwaiti citizen, age 29 → Established Customer segment. Civil ID Status is Not Applicable (Kuwaiti exemption). Nationality participates in scoring at its configured 10% weight (Kuwaiti → 1.00).',
    data: base({
      civil_id: '110203040003', date_of_birth: dobForAge(29), age: 29,
      nationality: 'KW', residency_status: 'CITIZEN',
      employment_status: 'EMPLOYED', employer_tier: 'sme', employment_tenure_months: 30,
      monthly_income: 700, cinet_score: 680, monthly_debt_obligations: 224,
    }),
  },
  {
    id: 'sample_d',
    label: 'D — Jordanian Customer',
    description: 'Jordanian resident, age 23 → Young Adult segment. Non-Kuwaiti, so Civil ID Status IS evaluated normally (VALID). Explicit PACI-sourced residency dates drive Residency Duration/Stability. Nationality scores at its configured 10% weight using its own (non-Kuwaiti) category value.',
    data: base({
      civil_id: '110203040004', date_of_birth: dobForAge(23), age: 23,
      nationality: 'JO', residency_status: 'RESIDENT',
      residency_start_date: '2018-01-01', residency_expiry_date: '2028-12-31',
      employment_status: 'EMPLOYED', employer_tier: 'large_corp', employment_tenure_months: 36,
      monthly_income: 850, cinet_score: 700, monthly_debt_obligations: 200,
    }),
  },
  {
    id: 'sample_e',
    label: 'E — Indian Customer',
    description: 'Indian resident, age 30 → Established Customer segment. Non-Kuwaiti, so Civil ID Status IS evaluated normally (VALID). Explicit PACI-sourced residency dates drive Residency Duration/Stability. Nationality scores at its configured 10% weight using its own (non-Kuwaiti) category value.',
    data: base({
      civil_id: '110203040005', date_of_birth: dobForAge(30), age: 30,
      nationality: 'IN', residency_status: 'RESIDENT',
      residency_start_date: '2013-03-01', residency_expiry_date: '2029-01-01',
      employment_status: 'EMPLOYED', employer_tier: 'sme', employment_tenure_months: 30,
      monthly_income: 700, cinet_score: 680, monthly_debt_obligations: 224,
    }),
  },
  {
    id: 'sample_f',
    label: 'F — CINET Unavailable',
    description: 'Kuwaiti citizen, age 34 → Established Customer segment, otherwise a clean profile. CINET was never checked for this assessment: CINET Score is excluded (never scored as zero, never invented) and the remaining scoring factors are re-weighted proportionally back to 100%, per the configured Missing Data Behavior.',
    data: base({
      civil_id: '110203040006', date_of_birth: dobForAge(34), age: 34,
      nationality: 'KW', residency_status: 'CITIZEN',
      employment_status: 'EMPLOYED', employer_tier: 'government', employment_tenure_months: 60,
      monthly_income: 900, monthly_debt_obligations: 150,
      cinet_status: 'NOT_CHECKED', cinet_score: null, cinet_score_cluster: null, cinet_evaluation_month: null,
      total_active_bnpl_accounts: null, total_monthly_bnpl_payment: null,
      total_overdue_bnpl_amount: null, worst_account_status: null,
      max_outstanding_payments_24m: null, cinet_open_accounts: null,
    }),
  },
  {
    id: 'sample_g',
    label: 'G — Preapproved Customer',
    description: 'Jordanian resident, Young Adult segment. Normal scoring lands in Manual Review, but this civil ID is on the seeded Preapproved Marketing List — expect an Approve at the lowest configured tier.',
    data: base({
      civil_id: '555000000001', mobile_number: '+96555000001',
      date_of_birth: dobForAge(23), age: 23,
      nationality: 'JO', residency_status: 'RESIDENT',
      residency_start_date: '2020-01-01', residency_expiry_date: '2029-01-01',
      employment_status: 'EMPLOYED', employer_tier: 'sme', employment_tenure_months: 6,
      monthly_income: 500, cinet_score: 420, monthly_debt_obligations: 150,
    }),
  },
];
