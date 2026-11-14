import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase, type Settings } from './supabase';

type SettingsState = {
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
};

const SettingsContext = createContext<SettingsState>({ settings: null, refreshSettings: async () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  const refreshSettings = useCallback(async () => {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
    if (error) console.warn('Could not load settings', error.message);
    setSettings(data as Settings | null);
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return <SettingsContext.Provider value={{ settings, refreshSettings }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
export const useUnits = () => useSettings().settings?.units ?? 'imperial';
