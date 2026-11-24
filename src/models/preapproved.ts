// Preapproved Marketing List — Trolley/marketing customers uploaded before registration.
// Kept structurally separate from the scoring Configuration: this is operational
// marketing data, not a scoring/decisioning rule, and is never included in config export.

export interface PreapprovedEntry {
  id: string;

  batchId: string;
  batchName?: string;

  civilId?: string;
  mobile?: string;
  email?: string;
  customerName?: string;

  uploadedAt: string;

  status: 'active' | 'inactive';

  notes?: string;
}

export interface PreapprovedBatch {
  id: string;
  name: string;
  fileName?: string;
  uploadedAt: string;
  totalEntries: number;
  activeEntries: number;
}

export type PreapprovedMatchStatus = 'matched_civil_id' | 'matched_phone' | 'not_matched';

export interface PreapprovedMatchResult {
  status: PreapprovedMatchStatus;
  entry?: PreapprovedEntry;
}

export const PREAPPROVED_MATCH_LABELS: Record<PreapprovedMatchStatus, string> = {
  matched_civil_id: 'Matched by Verified Civil ID',
  matched_phone: 'Matched by Mobile',
  not_matched: 'Not Preapproved',
};

/**
 * Policy lives inside the versioned scoring Configuration (so it's included in
 * config export/import), but never grants a bypass of hard gates or segmentation —
 * those two flags are fixed at false and are not user-editable.
 */
export interface PreapprovedPolicy {
  enabled: boolean;
  matchingPriority: ('verified_civil_id' | 'mobile')[];
  decisionOverride: {
    mode: 'floor_to_lowest_approve_tier';
    bypassesHardGates: false;
    bypassesSegment: false;
  };
}

export interface PreapprovedFloorResult {
  applied: boolean;
  decisionOutcome: 'APPROVE' | 'MANUAL_REVIEW' | 'REJECT';
  tier: string | null;
  reasonCode: string | null;
  configError: boolean;
}
