import type { ImportRowInput } from '../storage/preapprovedStorage';
import { normalizeCivilId, normalizePhone } from '../engine/preapprovedEngine';

function normalizeImportRow(row: Record<string, unknown>): ImportRowInput {
  const lower: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    lower[key.trim().toLowerCase().replace(/\s+/g, '_')] = value;
  }
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = lower[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return undefined;
  };
  return {
    civilId: pick('civil_id', 'civilid', 'civil_id_number'),
    mobile: pick('mobile', 'mobile_number', 'phone', 'phone_number'),
    email: pick('email', 'email_address'),
    customerName: pick('customer_name', 'customername', 'name', 'full_name'),
    notes: pick('notes', 'note'),
  };
}

/** Parses the first sheet of an uploaded .csv/.xlsx/.xls file into raw import rows. */
export async function parseSpreadsheetFile(file: File): Promise<ImportRowInput[]> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return json.map(normalizeImportRow);
}

export interface ValidatedImportRow {
  row: ImportRowInput;
  valid: boolean;
  emptyRow: boolean;
  missingIdentifier: boolean;
  duplicateInFile: boolean;
  issues: string[];
}

/**
 * Validates a batch of rows before import: rejects rows with neither a Civil ID nor a
 * Mobile, rejects completely empty rows, and flags duplicate Civil IDs/Mobiles within
 * the same file (cross-file/store duplicates are handled separately at import time via
 * the skip/replace strategy).
 */
export function validateImportRows(rows: ImportRowInput[]): ValidatedImportRow[] {
  const civilSeen = new Set<string>();
  const mobileSeen = new Set<string>();

  return rows.map((raw) => {
    const row: ImportRowInput = {
      civilId: raw.civilId?.trim() || undefined,
      mobile: raw.mobile?.trim() || undefined,
      email: raw.email?.trim() || undefined,
      customerName: raw.customerName?.trim() || undefined,
      notes: raw.notes?.trim() || undefined,
    };
    const issues: string[] = [];
    const emptyRow = !row.civilId && !row.mobile && !row.email && !row.customerName;
    const missingIdentifier = !emptyRow && !row.civilId && !row.mobile;
    if (emptyRow) issues.push('Empty row');
    if (missingIdentifier) issues.push('Missing both Civil ID and Mobile');

    let duplicateInFile = false;
    if (row.civilId) {
      const key = normalizeCivilId(row.civilId);
      if (civilSeen.has(key)) {
        duplicateInFile = true;
        issues.push('Duplicate Civil ID within this file');
      }
      civilSeen.add(key);
    }
    if (row.mobile) {
      const key = normalizePhone(row.mobile);
      if (mobileSeen.has(key)) {
        duplicateInFile = true;
        issues.push('Duplicate Mobile within this file');
      }
      mobileSeen.add(key);
    }

    return { row, valid: !emptyRow && !missingIdentifier, emptyRow, missingIdentifier, duplicateInFile, issues };
  });
}
