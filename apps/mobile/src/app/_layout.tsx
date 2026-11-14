import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { healthAvailable, syncFromHealth } from '@/lib/healthkit';
import { SettingsProvider } from '@/lib/settings';

export default function RootLayout() {
  // Pull the last few days from Apple Health whenever the app opens.
  useEffect(() => {
    if (!healthAvailable()) return;
    syncFromHealth(7).catch((e) => console.warn('Health sync failed', e));
  }, []);

  return (
    <SettingsProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SettingsProvider>
  );
}
