import type { AiAdvisorAuditRecord } from '../models/aiAdvisor';

const AI_AUDIT_KEY = 'brdgpay.aiAdvisorAudits';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getAiAuditRecords(): AiAdvisorAuditRecord[] {
  return readJson<AiAdvisorAuditRecord[]>(AI_AUDIT_KEY, []);
}

/** Most recent invocation for a given decision — a decision could in principle be re-run through the Advisor. */
export function getAiAuditForDecision(decisionId: string): AiAdvisorAuditRecord | undefined {
  const records = getAiAuditRecords();
  return [...records].reverse().find((r) => r.decisionId === decisionId);
}

/** The AI invocation record is appended once and never rewritten — only `recordReviewerAction` ever touches it again. */
export function saveAiAuditRecord(record: AiAdvisorAuditRecord): void {
  const records = getAiAuditRecords();
  records.push(record);
  writeJson(AI_AUDIT_KEY, records);
}

/** The only mutation an audit record ever receives: the reviewer's own confirmation, appended alongside the untouched AI invocation data. */
export function recordReviewerAction(
  auditId: string,
  patch: Pick<AiAdvisorAuditRecord, 'reviewerUserName' | 'reviewerAction' | 'reviewerFinalDecision' | 'reviewerOverrideReason'>
): AiAdvisorAuditRecord | undefined {
  const records = getAiAuditRecords();
  const idx = records.findIndex((r) => r.id === auditId);
  if (idx === -1) return undefined;
  const updated: AiAdvisorAuditRecord = { ...records[idx], ...patch, reviewerActionAt: new Date().toISOString() };
  records[idx] = updated;
  writeJson(AI_AUDIT_KEY, records);
  return updated;
}
