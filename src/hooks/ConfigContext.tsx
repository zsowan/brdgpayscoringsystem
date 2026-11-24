import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Configuration } from '../models/configuration';
import type { DecisionResult } from '../models/decision';
import type { PreapprovedBatch, PreapprovedEntry } from '../models/preapproved';
import * as storage from '../storage/localStorageService';
import * as preapprovedStorage from '../storage/preapprovedStorage';
import type { ImportRowInput } from '../storage/preapprovedStorage';

interface ConfigContextValue {
  configs: Configuration[];
  activeConfig: Configuration;
  history: DecisionResult[];
  refreshConfigs: () => void;
  updateActiveConfig: (updater: (cfg: Configuration) => Configuration) => void;
  saveConfig: (cfg: Configuration) => void;
  createDraft: () => Configuration;
  cloneConfig: (id: string) => Configuration;
  activateConfig: (id: string) => void;
  retireConfig: (id: string) => void;
  deleteConfig: (id: string) => void;
  importConfig: (json: string) => Configuration;
  resetDemo: () => void;
  refreshHistory: () => void;
  addDecision: (result: DecisionResult) => void;
  clearHistory: () => void;

  // Preapproved Marketing List — kept as separate state from the scoring Configuration.
  preapprovedEntries: PreapprovedEntry[];
  preapprovedBatches: PreapprovedBatch[];
  refreshPreapproved: () => void;
  importPreapprovedBatch: (
    batchMeta: { id: string; name: string; fileName?: string },
    rows: ImportRowInput[],
    duplicateStrategy: 'skip' | 'replace'
  ) => { batch: PreapprovedBatch; imported: number; skipped: number };
  addPreapprovedEntry: (entry: ImportRowInput, batch: { id: string; name: string }) => PreapprovedEntry;
  setPreapprovedEntryStatus: (id: string, status: 'active' | 'inactive') => void;
  deletePreapprovedEntry: (id: string) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [configs, setConfigs] = useState<Configuration[]>(() => storage.getConfigurations());
  const [history, setHistory] = useState<DecisionResult[]>(() => storage.getDecisionHistory());
  const [preapprovedEntries, setPreapprovedEntries] = useState<PreapprovedEntry[]>(() => preapprovedStorage.getPreapprovedEntries());
  const [preapprovedBatches, setPreapprovedBatches] = useState<PreapprovedBatch[]>(() => preapprovedStorage.getPreapprovedBatches());

  const activeConfig = useMemo(
    () => configs.find((c) => c.status === 'ACTIVE') ?? configs[0],
    [configs]
  );

  const refreshConfigs = useCallback(() => setConfigs(storage.getConfigurations()), []);
  const refreshHistory = useCallback(() => setHistory(storage.getDecisionHistory()), []);

  const saveConfig = useCallback((cfg: Configuration) => {
    storage.upsertConfiguration(cfg);
    refreshConfigs();
  }, [refreshConfigs]);

  const updateActiveConfig = useCallback((updater: (cfg: Configuration) => Configuration) => {
    const current = storage.getActiveConfiguration();
    const next = updater(current);
    storage.upsertConfiguration(next);
    refreshConfigs();
  }, [refreshConfigs]);

  const createDraft = useCallback(() => {
    const draft = storage.createDraftFromActive();
    refreshConfigs();
    return draft;
  }, [refreshConfigs]);

  const cloneConfig = useCallback((id: string) => {
    const clone = storage.cloneConfiguration(id);
    refreshConfigs();
    return clone;
  }, [refreshConfigs]);

  const activateConfig = useCallback((id: string) => {
    storage.activateConfiguration(id);
    refreshConfigs();
  }, [refreshConfigs]);

  const retireConfig = useCallback((id: string) => {
    storage.retireConfiguration(id);
    refreshConfigs();
  }, [refreshConfigs]);

  const deleteConfig = useCallback((id: string) => {
    storage.deleteConfiguration(id);
    refreshConfigs();
  }, [refreshConfigs]);

  const importConfig = useCallback((json: string) => {
    const imported = storage.importConfigurationJson(json);
    refreshConfigs();
    return imported;
  }, [refreshConfigs]);

  const refreshPreapproved = useCallback(() => {
    setPreapprovedEntries(preapprovedStorage.getPreapprovedEntries());
    setPreapprovedBatches(preapprovedStorage.getPreapprovedBatches());
  }, []);

  const resetDemo = useCallback(() => {
    storage.resetDemoConfiguration();
    preapprovedStorage.resetPreapprovedData();
    refreshConfigs();
    refreshHistory();
    refreshPreapproved();
  }, [refreshConfigs, refreshHistory, refreshPreapproved]);

  const addDecision = useCallback((result: DecisionResult) => {
    storage.saveDecision(result);
    refreshHistory();
  }, [refreshHistory]);

  const clearHistory = useCallback(() => {
    storage.clearDecisionHistory();
    refreshHistory();
  }, [refreshHistory]);

  const importPreapprovedBatch = useCallback(
    (batchMeta: { id: string; name: string; fileName?: string }, rows: ImportRowInput[], duplicateStrategy: 'skip' | 'replace') => {
      const result = preapprovedStorage.importPreapprovedBatch(batchMeta, rows, duplicateStrategy);
      refreshPreapproved();
      return result;
    },
    [refreshPreapproved]
  );

  const addPreapprovedEntry = useCallback(
    (entry: ImportRowInput, batch: { id: string; name: string }) => {
      const created = preapprovedStorage.addPreapprovedEntry(entry, batch);
      refreshPreapproved();
      return created;
    },
    [refreshPreapproved]
  );

  const setPreapprovedEntryStatus = useCallback(
    (id: string, status: 'active' | 'inactive') => {
      preapprovedStorage.setEntryStatus(id, status);
      refreshPreapproved();
    },
    [refreshPreapproved]
  );

  const deletePreapprovedEntry = useCallback(
    (id: string) => {
      preapprovedStorage.deletePreapprovedEntry(id);
      refreshPreapproved();
    },
    [refreshPreapproved]
  );

  const value: ConfigContextValue = {
    configs,
    activeConfig,
    history,
    refreshConfigs,
    updateActiveConfig,
    saveConfig,
    createDraft,
    cloneConfig,
    activateConfig,
    retireConfig,
    deleteConfig,
    importConfig,
    resetDemo,
    refreshHistory,
    addDecision,
    clearHistory,
    preapprovedEntries,
    preapprovedBatches,
    refreshPreapproved,
    importPreapprovedBatch,
    addPreapprovedEntry,
    setPreapprovedEntryStatus,
    deletePreapprovedEntry,
  };

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfigStore(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigStore must be used within a ConfigProvider');
  return ctx;
}
