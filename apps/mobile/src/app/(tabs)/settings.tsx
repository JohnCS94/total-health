import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { Body, Button, Card, Chip, Input, Row, Title, useTheme } from '@/components/ui';
import { healthAvailable, syncFromHealth } from '@/lib/healthkit';
import { hevyConfigured, lastHevySync, syncHevy } from '@/lib/hevy';
import { useSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { kgTo, mlTo, round, toKg, toMl, waterLabel, weightLabel, type Units } from '@/lib/units';

export default function Settings() {
  const t = useTheme();
  const { settings, refreshSettings } = useSettings();
  const [name, setName] = useState('');
  const [units, setUnits] = useState<Units>('imperial');
  const [calGoal, setCalGoal] = useState('');
  const [waterGoal, setWaterGoal] = useState('');
  const [weightGoal, setWeightGoal] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [hevySyncing, setHevySyncing] = useState(false);
  const [hevyLast, setHevyLast] = useState<string | null>(null);

  useEffect(() => {
    if (hevyConfigured()) lastHevySync().then(setHevyLast);
  }, []);

  useEffect(() => {
    if (!settings) return;
    setName(settings.display_name ?? '');
    setUnits(settings.units);
    setCalGoal(String(settings.calorie_goal ?? ''));
    setWaterGoal(settings.water_goal_ml ? String(round(mlTo(settings.water_goal_ml, settings.units), 0)) : '');
    setWeightGoal(settings.weight_goal_kg ? String(round(kgTo(Number(settings.weight_goal_kg), settings.units))) : '');
  }, [settings]);

  async function save() {
    const { error } = await supabase.from('settings').upsert({
      id: 1,
      display_name: name.trim() || null,
      units,
      calorie_goal: calGoal ? parseInt(calGoal, 10) : null,
      water_goal_ml: waterGoal ? Math.round(toMl(parseFloat(waterGoal), units)) : null,
      weight_goal_kg: weightGoal ? round(toKg(parseFloat(weightGoal), units), 2) : null,
    });
    if (error) return Alert.alert('Error', error.message);
    await refreshSettings();
    Alert.alert('Saved');
  }

  async function sync(days: number) {
    setSyncing(true);
    try {
      const r = await syncFromHealth(days);
      const lines = [`${r.food} foods · ${r.weight} weight · ${r.water} water · ${r.sleepNights} nights of sleep · ${r.workouts} workouts`];
      if (r.duplicatesRemoved) lines.push(`Removed ${r.duplicatesRemoved} duplicate workout${r.duplicatesRemoved === 1 ? '' : 's'}.`);
      if (r.empty.length)
        lines.push(
          `\nNo ${r.empty.join(', ')} data came back from Health. If you do have it, the permission is probably off: iPhone Settings → Health → Data Access & Devices → Health → turn on ${r.empty.join(', ')}.`,
        );
      Alert.alert('Synced from Apple Health', lines.join('\n'));
    } catch (e) {
      Alert.alert('Sync failed', String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function hevySync() {
    setHevySyncing(true);
    try {
      const r = await syncHevy();
      setHevyLast(new Date().toISOString());
      Alert.alert(
        'Synced from Hevy',
        r.updated || r.deleted
          ? `${r.updated} workout${r.updated === 1 ? '' : 's'} added/updated${r.deleted ? `, ${r.deleted} removed` : ''}${r.firstSync ? ' (full history)' : ''}.`
          : 'Already up to date.',
      );
    } catch (e) {
      Alert.alert('Hevy sync failed', String(e));
    } finally {
      setHevySyncing(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Title>Apple Health</Title>
        {healthAvailable() ? (
          <>
            <Body muted>
              Imports food (from Lose It), weight, sleep, water and workouts. Recent data syncs automatically each time you open the app or pull to refresh on
              Today.
            </Body>
            <Row>
              <Button title="Sync 30 days" onPress={() => sync(30)} loading={syncing} style={{ flex: 1 }} />
              <Button title="Sync 1 year" variant="outline" onPress={() => sync(365)} disabled={syncing} style={{ flex: 1 }} />
            </Row>
          </>
        ) : (
          <Body muted>Apple Health isn't available on this device.</Body>
        )}
      </Card>

      <Card>
        <Title>Hevy</Title>
        {hevyConfigured() ? (
          <>
            <Body muted>
              Pulls new, edited and deleted lifting workouts from Hevy. The first sync imports your full history.
              {hevyLast ? ` Last synced ${new Date(hevyLast).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}
            </Body>
            <Button title="Sync Hevy" onPress={hevySync} loading={hevySyncing} />
          </>
        ) : (
          <Body muted>Add EXPO_PUBLIC_HEVY_API_KEY to apps/mobile/.env.local to enable Hevy sync.</Body>
        )}
      </Card>

      <Card>
        <Title>Goals & units</Title>
        <Input label="Name (shown on the website)" placeholder="e.g. John" value={name} onChangeText={setName} />
        <Row>
          <Chip label="imperial" active={units === 'imperial'} onPress={() => setUnits('imperial')} />
          <Chip label="metric" active={units === 'metric'} onPress={() => setUnits('metric')} />
        </Row>
        <Row>
          <Input label="Calories / day" keyboardType="number-pad" value={calGoal} onChangeText={setCalGoal} />
          <Input label={`Water (${waterLabel(units)})`} keyboardType="number-pad" value={waterGoal} onChangeText={setWaterGoal} />
          <Input label={`Goal wt (${weightLabel(units)})`} keyboardType="decimal-pad" value={weightGoal} onChangeText={setWeightGoal} />
        </Row>
        <Button title="Save" onPress={save} />
      </Card>
    </ScrollView>
  );
}
