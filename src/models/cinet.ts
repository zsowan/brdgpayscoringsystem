// CINET BNPL credit-bureau data shapes, aligned to the CINET BNPL Live Request
// User Manual V1.5 field concepts. Only fields actually represented in that manual
// are modeled here — nothing invented.

/**
 * One open BNPL account record from the CINET response.
 * Conceptually maps to: ACCOUNTSTATUS, NOOFPAYMENTSOUTSTANDING,
 * OUTSTANDINGBALANCE, OVERDUEBALANCE, DPD.
 * Technical detail only — never rendered in the normal Customer Playground,
 * only in the Integration Simulator's technical view.
 */
export interface CinetOpenAccount {
  accountNo: string;
  accountStatus: string;
  paymentsOutstanding: number | null;
  outstandingBalance: number | null;
  overdueBalance: number | null;
  dpd: number | null;
}

/** Demo-only status catalogue — the real CINET status catalogue is not defined in this playground. */
export const WORST_ACCOUNT_STATUS_OPTIONS = ['CURRENT', 'DELINQUENT', 'SERIOUS_DELINQUENCY', 'UNKNOWN'] as const;

export const WORST_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  CURRENT: 'Current',
  DELINQUENT: 'Delinquent',
  SERIOUS_DELINQUENCY: 'Serious Delinquency',
  UNKNOWN: 'Unknown',
};

/**
 * Whether a CINET credit-score check was actually performed for this assessment —
 * independent of the other CINET bureau fields (overdue amount, delinquency data,
 * etc.), which keep following the existing Integration Simulator state. A customer
 * can be registered and given a preliminary score with CINET NOT_CHECKED, then
 * re-assessed later once it becomes AVAILABLE.
 */
export const CINET_STATUS_OPTIONS = ['NOT_CHECKED', 'AVAILABLE', 'TIMEOUT', 'ERROR'] as const;
export type CinetStatus = (typeof CINET_STATUS_OPTIONS)[number];

export const CINET_STATUS_LABELS: Record<CinetStatus, string> = {
  NOT_CHECKED: 'Not Checked',
  AVAILABLE: 'Available',
  TIMEOUT: 'Timeout',
  ERROR: 'Error',
};

export type AssessmentType = 'preliminary' | 'full';

export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  preliminary: 'Preliminary Credit Assessment',
  full: 'Full Credit Assessment',
};

/**
 * Flat customer-record view of a CINET response, for documentation purposes —
 * the app stores these as individual CustomerRecord fields rather than a nested
 * object, consistent with the rest of the project's conventions.
 *
 * currentScore -> cinet_score (CURRENTSCORE)
 * currentScoreCluster -> cinet_score_cluster (CURRENTSCORECLUSTER)
 * evaluationMonth -> cinet_evaluation_month (EVALUATIONMONTH)
 * totalActiveBnplAccounts -> total_active_bnpl_accounts (TOTAL_NO_ACTIVE_BNPL_ACC)
 * totalMonthlyBnplPayment -> total_monthly_bnpl_payment (TOTAL_MONTHLY_PAYMENT_BNPL)
 * totalOverdueBnplAmount -> total_overdue_bnpl_amount (TOTAL_OVERDUE_AMT_BNPL_ACC)
 * worstAccountStatus -> worst_account_status (WORST_STATUS_ACC_CONS, demo values only)
 * maxOutstandingPayments24m -> max_outstanding_payments_24m (WORST_NO_OF_OUTSTD_PAYMNT_CONS)
 * openAccounts -> cinet_open_accounts (technical detail only)
 */
export interface CinetCreditProfile {
  currentScore: number | null;
  currentScoreCluster?: string | null;
  evaluationMonth?: string | null;

  totalActiveBnplAccounts: number | null;
  totalMonthlyBnplPayment: number | null;
  totalOverdueBnplAmount: number | null;

  worstAccountStatus: string | null;
  maxOutstandingPayments24m: number | null;

  openAccounts: CinetOpenAccount[];

  status: 'success' | 'timeout' | 'error';
}
