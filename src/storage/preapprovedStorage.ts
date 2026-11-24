import { v4 as uuidv4 } from 'uuid';
import type { PreapprovedBatch, PreapprovedEntry } from '../models/preapproved';

// Deliberately separate LocalStorage keys from the scoring Configuration — marketing
// customer data must never ride along with a config export/import.
const ENTRIES_KEY = 'brdgpay.preapprovedEntries';
const BATCHES_KEY = 'brdgpay.preapprovedBatches';

const DEMO_BATCH_ID = 'TROLLEY-DEMO-001';
const DEMO_BATCH_NAME = 'Trolley Demo Campaign';

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

function buildSeedData(): { batch: PreapprovedBatch; entries: PreapprovedEntry[] } {
  const now = new Date().toISOString();
  const entries: PreapprovedEntry[] = [
    {
      id: uuidv4(), batchId: DEMO_BATCH_ID, batchName: DEMO_BATCH_NAME,
      civilId: '555000000001', mobile: '+96555000001', email: 'preapproved.1@example.com', customerName: 'Preapproved Demo Customer 1',
      uploadedAt: now, status: 'active', notes: 'Matches Sample G (Preapproved Customer) — matched by civil ID.',
    },
    {
      id: uuidv4(), batchId: DEMO_BATCH_ID, batchName: DEMO_BATCH_NAME,
      civilId: '555000000002', mobile: '+96555000002', email: 'preapproved.2@example.com', customerName: 'Preapproved Demo Customer 2',
      uploadedAt: now, status: 'active', notes: 'Seeded demo entry — try it in the Matching Simulator.',
    },
    {
      id: uuidv4(), batchId: DEMO_BATCH_ID, batchName: DEMO_BATCH_NAME,
      civilId: '555000000003', mobile: '+96555000003', email: 'preapproved.3@example.com', customerName: 'Preapproved Demo Customer 3',
      uploadedAt: now, status: 'active', notes: 'Seeded demo entry — try it in the Matching Simulator.',
    },
    {
      id: uuidv4(), batchId: DEMO_BATCH_ID, batchName: DEMO_BATCH_NAME,
      civilId: '555000000004', mobile: '+96555000004', email: 'preapproved.4@example.com', customerName: 'Preapproved Demo Customer 4',
      uploadedAt: now, status: 'active', notes: 'Seeded demo entry — try it in the Matching Simulator.',
    },
  ];
  const batch: PreapprovedBatch = {
    id: DEMO_BATCH_ID, name: DEMO_BATCH_NAME, fileName: undefined, uploadedAt: now,
    totalEntries: entries.length, activeEntries: entries.length,
  };
  return { batch, entries };
}

export function getPreapprovedEntries(): PreapprovedEntry[] {
  const entries = readJson<PreapprovedEntry[]>(ENTRIES_KEY, []);
  if (entries.length === 0 && readJson<PreapprovedBatch[]>(BATCHES_KEY, []).length === 0) {
    const { batch, entries: seeded } = buildSeedData();
    writeJson(BATCHES_KEY, [batch]);
    writeJson(ENTRIES_KEY, seeded);
    return seeded;
  }
  return entries;
}

export function getPreapprovedBatches(): PreapprovedBatch[] {
  // Ensure seeding has happened (entries getter seeds both keys together).
  getPreapprovedEntries();
  return readJson<PreapprovedBatch[]>(BATCHES_KEY, []);
}

function saveEntries(entries: PreapprovedEntry[]): void {
  writeJson(ENTRIES_KEY, entries);
}

function saveBatches(batches: PreapprovedBatch[]): void {
  writeJson(BATCHES_KEY, batches);
}

function recomputeBatchCounts(batchId: string): void {
  const entries = getPreapprovedEntries().filter((e) => e.batchId === batchId);
  const batches = getPreapprovedBatches().map((b) =>
    b.id === batchId ? { ...b, totalEntries: entries.length, activeEntries: entries.filter((e) => e.status === 'active').length } : b
  );
  saveBatches(batches);
}

export interface ImportRowInput {
  civilId?: string;
  mobile?: string;
  email?: string;
  customerName?: string;
  notes?: string;
}

/**
 * Imports a batch of validated rows. `duplicateStrategy` controls what happens when a
 * row's civil ID or mobile already exists in the store (across any batch):
 * "skip" leaves the existing entry untouched, "replace" overwrites it in place.
 */
export function importPreapprovedBatch(
  batchMeta: { id: string; name: string; fileName?: string },
  rows: ImportRowInput[],
  duplicateStrategy: 'skip' | 'replace'
): { batch: PreapprovedBatch; imported: number; skipped: number } {
  const now = new Date().toISOString();
  const existing = getPreapprovedEntries();
  const existingByCivilId = new Map(existing.filter((e) => e.civilId).map((e) => [e.civilId!.trim().toUpperCase(), e]));
  const existingByMobile = new Map(existing.filter((e) => e.mobile).map((e) => [e.mobile!.replace(/\D/g, ''), e]));

  let imported = 0;
  let skipped = 0;
  const next = [...existing];

  for (const row of rows) {
    const civilKey = row.civilId?.trim().toUpperCase();
    const mobileKey = row.mobile?.replace(/\D/g, '');
    // Check both the pre-existing store AND rows already processed earlier in this
    // same import — otherwise two duplicate rows in one file both slip through as new inserts.
    const existingMatch = (civilKey && existingByCivilId.get(civilKey)) || (mobileKey && existingByMobile.get(mobileKey));

    if (existingMatch) {
      if (duplicateStrategy === 'skip') {
        skipped++;
        continue;
      }
      const idx = next.findIndex((e) => e.id === existingMatch.id);
      if (idx !== -1) {
        const updated: PreapprovedEntry = {
          ...next[idx],
          civilId: row.civilId || next[idx].civilId,
          mobile: row.mobile || next[idx].mobile,
          email: row.email || next[idx].email,
          customerName: row.customerName || next[idx].customerName,
          notes: row.notes || next[idx].notes,
          batchId: batchMeta.id,
          batchName: batchMeta.name,
          uploadedAt: now,
          status: 'active',
        };
        next[idx] = updated;
        if (updated.civilId) existingByCivilId.set(updated.civilId.trim().toUpperCase(), updated);
        if (updated.mobile) existingByMobile.set(updated.mobile.replace(/\D/g, ''), updated);
        imported++;
        continue;
      }
    }

    const created: PreapprovedEntry = {
      id: uuidv4(),
      batchId: batchMeta.id,
      batchName: batchMeta.name,
      civilId: row.civilId,
      mobile: row.mobile,
      email: row.email,
      customerName: row.customerName,
      notes: row.notes,
      uploadedAt: now,
      status: 'active',
    };
    next.push(created);
    if (civilKey) existingByCivilId.set(civilKey, created);
    if (mobileKey) existingByMobile.set(mobileKey, created);
    imported++;
  }

  saveEntries(next);

  const batchEntries = next.filter((e) => e.batchId === batchMeta.id);
  const batches = getPreapprovedBatches();
  const existingBatchIdx = batches.findIndex((b) => b.id === batchMeta.id);
  const batchRecord: PreapprovedBatch = {
    id: batchMeta.id,
    name: batchMeta.name,
    fileName: batchMeta.fileName,
    uploadedAt: now,
    totalEntries: batchEntries.length,
    activeEntries: batchEntries.filter((e) => e.status === 'active').length,
  };
  if (existingBatchIdx === -1) {
    saveBatches([...batches, batchRecord]);
  } else {
    saveBatches(batches.map((b, i) => (i === existingBatchIdx ? batchRecord : b)));
  }

  return { batch: batchRecord, imported, skipped };
}

export function addPreapprovedEntry(entry: ImportRowInput, batch: { id: string; name: string }): PreapprovedEntry {
  const entries = getPreapprovedEntries();
  const newEntry: PreapprovedEntry = {
    id: uuidv4(),
    batchId: batch.id,
    batchName: batch.name,
    civilId: entry.civilId,
    mobile: entry.mobile,
    email: entry.email,
    customerName: entry.customerName,
    notes: entry.notes,
    uploadedAt: new Date().toISOString(),
    status: 'active',
  };
  saveEntries([...entries, newEntry]);

  const batches = getPreapprovedBatches();
  if (!batches.some((b) => b.id === batch.id)) {
    saveBatches([...batches, { id: batch.id, name: batch.name, uploadedAt: newEntry.uploadedAt, totalEntries: 1, activeEntries: 1 }]);
  } else {
    recomputeBatchCounts(batch.id);
  }
  return newEntry;
}

export function setEntryStatus(id: string, status: 'active' | 'inactive'): void {
  const entries = getPreapprovedEntries();
  const entry = entries.find((e) => e.id === id);
  saveEntries(entries.map((e) => (e.id === id ? { ...e, status } : e)));
  if (entry) recomputeBatchCounts(entry.batchId);
}

export function deletePreapprovedEntry(id: string): void {
  const entries = getPreapprovedEntries();
  const entry = entries.find((e) => e.id === id);
  saveEntries(entries.filter((e) => e.id !== id));
  if (entry) recomputeBatchCounts(entry.batchId);
}

export function resetPreapprovedData(): void {
  const { batch, entries } = buildSeedData();
  saveBatches([batch]);
  saveEntries(entries);
}

export function generateBatchId(name: string): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug || 'BATCH'}-${stamp}`;
}
