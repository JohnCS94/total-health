import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { Body, Button, Card, Chip, Input, Row, Title, accent, useTheme } from '@/components/ui';
import { useUnits } from '@/lib/settings';
import { healthAvailable, saveWaterToHealth, saveWeightToHealth } from '@/lib/healthkit';
import { dayRange, localDate, supabase } from '@/lib/supabase';
import { distanceLabel, mlTo, round, toKg, toKm, toMl, waterLabel, waterPresets, weightLabel } from '@/lib/units';

const ACTIVITIES = ['running', 'walking', 'cycling', 'strength', 'hiit', 'yoga', 'swimming', 'hiking', 'other'];

export default function Log() {
  const t = useTheme();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
        <WeightCard />
        <WaterCard />
        <SleepCard />
        <WorkoutCard />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Best-effort write to Apple Health; never blocks saving to Supabase. */
async function tryHealth<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!healthAvailable()) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn('Health write failed', e);
    return undefined;
  }
}

function WeightCard() {
  const units = useUnits();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const v = parseFloat(value);
    if (!v) return;
    setBusy(true);
    const kg = round(toKg(v, units), 2);
    const now = new Date();
    const healthkit_uuid = await tryHealth(() => saveWeightToHealth(kg, now));
    const { error } = await supabase
      .from('weight_entries')
      .insert({ weight_kg: kg, measured_at: now.toISOString(), healthkit_uuid });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setValue('');
    Alert.alert('Saved', `${v} ${weightLabel(units)}`);
  }

  return (
    <Card>
      <Title color={accent.weight}>Weight</Title>
      <Row>
        <Input placeholder={`Today's weight (${weightLabel(units)})`} keyboardType="decimal-pad" value={value} onChangeText={setValue} />
        <Button title="Save" color={accent.weight} onPress={save} loading={busy} />
      </Row>
    </Card>
  );
}

function WaterCard() {
  const units = useUnits();
  const [todayMl, setTodayMl] = useState(0);
  const [custom, setCustom] = useState('');

  const load = useCallback(async () => {
    const { start, end } = dayRange();
    const { data } = await supabase.from('water_entries').select('amount_ml').gte('logged_at', start).lt('logged_at', end);
    setTodayMl((data ?? []).reduce((a, r) => a + r.amount_ml, 0));
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function add(amount: number) {
    const ml = Math.round(toMl(amount, units));
    if (ml <= 0) return;
    setTodayMl((x) => x + ml); // optimistic
    const now = new Date();
    const healthkit_uuid = await tryHealth(() => saveWaterToHealth(ml, now));
    const { error } = await supabase.from('water_entries').insert({ amount_ml: ml, logged_at: now.toISOString(), healthkit_uuid });
    if (error) Alert.alert('Error', error.message);
    load();
  }

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Title color={accent.water}>Water</Title>
        <Body muted>
          Today: {round(mlTo(todayMl, units), 0)} {waterLabel(units)}
        </Body>
      </Row>
      <Row>
        {waterPresets(units).map((p) => (
          <Button key={p} title={`+${p}`} variant="outline" color={accent.water} onPress={() => add(p)} style={{ flex: 1, paddingHorizontal: 4 }} />
        ))}
      </Row>
      <Row>
        <Input placeholder={`Custom (${waterLabel(units)})`} keyboardType="decimal-pad" value={custom} onChangeText={setCustom} />
        <Button
          title="Add"
          color={accent.water}
          onPress={() => {
            add(parseFloat(custom) || 0);
            setCustom('');
          }}
        />
      </Row>
    </Card>
  );
}

function SleepCard() {
  const [hours, setHours] = useState('');
  const [score, setScore] = useState('');
  const [existing, setExisting] = useState<{ hours: number | null; score: number | null; source: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('sleep_entries').select('hours, score, source').eq('sleep_date', localDate()).maybeSingle();
    setExisting(data);
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function save() {
    const row: Record<string, unknown> = { sleep_date: localDate() };
    if (hours) row.hours = parseFloat(hours);
    if (score) row.score = parseInt(score, 10);
    if (Object.keys(row).length === 1) return;
    setBusy(true);
    // Upsert by date so adding a score keeps the hours imported from Apple Health (and vice versa).
    const { error } = await supabase.from('sleep_entries').upsert(row, { onConflict: 'sleep_date' });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setHours('');
    setScore('');
    load();
  }

  return (
    <Card>
      <Title color={accent.sleep}>Last night's sleep</Title>
      {existing ? (
        <Body muted>
          Recorded: {existing.hours != null ? `${Number(existing.hours)} h` : '—'}
          {existing.source === 'healthkit' ? ' (Apple Health)' : ''} · Score {existing.score ?? '—'}
        </Body>
      ) : null}
      <Row>
        <Input label="Hours" placeholder="7.5" keyboardType="decimal-pad" value={hours} onChangeText={setHours} />
        <Input label="Sleep score" placeholder="0–100" keyboardType="number-pad" value={score} onChangeText={setScore} />
      </Row>
      <Button title="Save sleep" color={accent.sleep} onPress={save} loading={busy} />
    </Card>
  );
}

function WorkoutCard() {
  const units = useUnits();
  const [type, setType] = useState('running');
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const hasDistance = ['running', 'walking', 'cycling', 'swimming', 'hiking'].includes(type);

  async function save() {
    if (!duration) return Alert.alert('Duration required');
    setBusy(true);
    const { error } = await supabase.from('workouts').insert({
      activity_type: type,
      duration_min: parseFloat(duration),
      distance_km: hasDistance && distance ? round(toKm(parseFloat(distance), units), 2) : null,
      calories: calories ? parseFloat(calories) : null,
      notes: notes || null,
    });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setDuration('');
    setDistance('');
    setCalories('');
    setNotes('');
    Alert.alert('Workout saved');
  }

  return (
    <Card>
      <Title color={accent.workout}>Workout</Title>
      <Body muted style={{ fontSize: 13 }}>
        Workouts recorded on Apple Watch / Fitness import automatically. Log anything else here.
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ACTIVITIES.map((a) => (
          <Chip key={a} label={a} active={type === a} onPress={() => setType(a)} color={accent.workout} />
        ))}
      </View>
      <Row>
        <Input label="Minutes" keyboardType="decimal-pad" value={duration} onChangeText={setDuration} />
        {hasDistance ? (
          <Input label={`Distance (${distanceLabel(units)})`} keyboardType="decimal-pad" value={distance} onChangeText={setDistance} />
        ) : null}
        <Input label="Calories" keyboardType="number-pad" value={calories} onChangeText={setCalories} />
      </Row>
      <Input label="Notes" placeholder="e.g. 5x5 squat 225" value={notes} onChangeText={setNotes} />
      <Button title="Save workout" color={accent.workout} onPress={save} loading={busy} />
    </Card>
  );
}
