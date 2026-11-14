/**
 * Sleep sessions + Sleep Score.
 *
 * Score structure follows Apple's published Sleep Score (watchOS 26): 100 points =
 *   Duration 50 · Bedtime consistency 30 (vs. your last 13 nights) · Interruptions 20.
 * Apple doesn't publish the formulas inside each component, so the curves below are based on the
 * sleep literature:
 *   - Duration: AASM/Sleep Research Society + National Sleep Foundation recommend 7–9 h for adults.
 *     Full marks 7–9 h; steep falloff below 7 h (short sleep is where health risk rises); a mild
 *     penalty above 9.5 h.
 *   - Consistency: bedtime regularity (cf. the Sleep Regularity Index literature). Falling asleep within
 *     30 min of your usual (median of the previous 13 nights) gets full marks, declining to 0 at 2.5 h off.
 *   - Interruptions: wake after sleep onset (WASO). ≤ 20 min is typical of good sleepers; ≥ 60 min is a
 *     common clinical cut-off for poor sleep maintenance. Number of distinct wake-ups adds a smaller penalty.
 * Sleep stages (deep/REM) are stored but deliberately not scored, as Apple does: wrist-based stage
 * estimates are the least reliable part of consumer sleep tracking.
 *
 * Pure functions, no React Native imports, so this file is easy to test.
 */

export const SLEEP_VALUE = { inBed: 0, asleepUnspecified: 1, awake: 2, asleepCore: 3, asleepDeep: 4, asleepREM: 5 } as const;
const ASLEEP = new Set<number>([1, 3, 4, 5]);

export type SleepSample = { start: Date; end: Date; value: number; source: string };

export type SleepSession = {
  date: string; // local YYYY-MM-DD of the wake-up
  source: string;
  onset: Date; // first asleep moment (or in-bed start if the source has no stages)
  wake: Date; // last asleep moment
  asleepMs: number;
  inBedMs: number;
  deepMs: number;
  remMs: number;
  awakeMs: number; // wake after sleep onset (WASO)
  wakeCount: number; // distinct awakenings ≥ 2 min between onset and final wake
  hasStages: boolean;
};

export type SleepScore = {
  total: number;
  duration: number; // 0–50
  consistency: number; // 0–30
  interruptions: number; // 0–20
  consistencyBaselineNights: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A gap longer than this starts a new session (so a nap isn't merged into the night). */
const SESSION_GAP = 2 * HOUR;
const MIN_WAKE = 2 * MIN;

export function localDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Merge overlapping [start, end) intervals and return the total covered ms + the merged list. */
function union(intervals: [number, number][]) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return { merged: out, total: out.reduce((a, [s, e]) => a + (e - s), 0) };
}

function buildSession(source: string, samples: SleepSample[]): SleepSession | null {
  const iv = (pred: (v: number) => boolean) =>
    union(samples.filter((s) => pred(s.value)).map((s) => [s.start.getTime(), s.end.getTime()] as [number, number]));

  const asleep = iv((v) => ASLEEP.has(v));
  const inBed = iv((v) => v === SLEEP_VALUE.inBed);
  const deep = iv((v) => v === SLEEP_VALUE.asleepDeep);
  const rem = iv((v) => v === SLEEP_VALUE.asleepREM);
  const hasStages = asleep.total > 0;

  // Sources with only "in bed" (e.g. iPhone bedtime tracking) are treated as asleep for that time.
  const main = hasStages ? asleep.merged : inBed.merged;
  if (!main.length) return null;
  const onset = main[0][0];
  const wake = main[main.length - 1][1];

  // Awake time between onset and final wake: explicit "awake" samples, plus gaps in the asleep timeline
  // (some sources don't record awake segments).
  const awakeIv = union(
    samples
      .filter((s) => s.value === SLEEP_VALUE.awake)
      .map((s) => [Math.max(s.start.getTime(), onset), Math.min(s.end.getTime(), wake)] as [number, number])
      .filter(([s, e]) => e > s)
      .concat(main.slice(1).map((seg, i) => [main[i][1], seg[0]] as [number, number])),
  );
  const awakeMs = awakeIv.total;
  const wakeCount = awakeIv.merged.filter(([s, e]) => e - s >= MIN_WAKE).length;

  return {
    date: localDate(new Date(wake)),
    source,
    onset: new Date(onset),
    wake: new Date(wake),
    asleepMs: hasStages ? asleep.total : inBed.total,
    inBedMs: inBed.total,
    deepMs: deep.total,
    remMs: rem.total,
    awakeMs,
    wakeCount,
    hasStages,
  };
}

/**
 * Turn raw HealthKit sleep samples into one main sleep session per wake-up date.
 * Samples are split by source and clustered into sessions (gap > 2 h = new session). For each date the
 * session from a device that measures sleep (has stages) wins over "in bed"-only sources, then the
 * longest sleep wins, across all sources, so overlapping devices aren't double-counted
 * and naps don't replace the night.
 */
export function buildSessions(samples: SleepSample[]): SleepSession[] {
  const bySource = new Map<string, SleepSample[]>();
  for (const s of samples) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);

  const best = new Map<string, SleepSession>();
  for (const [source, list] of bySource) {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
    let cluster: SleepSample[] = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const sess = cluster.length ? buildSession(source, cluster) : null;
      if (sess) {
        const cur = best.get(sess.date);
        // Real sleep tracking (with stages) beats "in bed" only; then the longest sleep wins.
        const better = !cur || (sess.hasStages !== cur.hasStages ? sess.hasStages : sess.asleepMs > cur.asleepMs);
        if (better) best.set(sess.date, sess);
      }
      cluster = [];
    };
    for (const s of sorted) {
      if (cluster.length && s.start.getTime() - clusterEnd > SESSION_GAP) flush();
      cluster.push(s);
      clusterEnd = Math.max(clusterEnd, s.end.getTime());
    }
    flush();
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── scoring ─────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 0–50. Full marks 7–9.5 h. Below 7 h, eases down to 0 at 4 h (6 h ≈ 33, 5 h ≈ 15). Above 9.5 h, −4/h, floor 35. */
export function durationPoints(asleepHours: number) {
  if (asleepHours >= 7 && asleepHours <= 9.5) return 50;
  if (asleepHours > 9.5) return Math.max(35, 50 - (asleepHours - 9.5) * 4);
  const x = clamp01((asleepHours - 4) / 3);
  return 50 * x ** 1.4;
}

/** Minutes after 6 pm, so bedtimes either side of midnight compare correctly (11:30 pm = 330, 1 am = 420). */
export function bedtimeMinutes(d: Date) {
  return (d.getHours() * 60 + d.getMinutes() - 18 * 60 + 1440) % 1440;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 0–30. |onset − median onset of up to 13 previous nights|: ≤ 30 min → 30, linear to 0 at 150 min.
 * With fewer than 3 previous nights there's no reliable "usual" yet, so it scores 30 × 0.8 = 24.
 */
export function consistencyPoints(onset: Date, previousOnsets: Date[]) {
  if (previousOnsets.length < 3) return 24;
  const usual = median(previousOnsets.map(bedtimeMinutes));
  const diff = Math.abs(bedtimeMinutes(onset) - usual);
  return 30 * clamp01(1 - (diff - 30) / 120);
}

/** 0–20. WASO: ≤ 20 min full, 0 at 80 min (75% weight). Wake-ups: ≤ 2 full, 0 at 10 (25% weight). */
export function interruptionPoints(awakeMinutes: number, wakeCount: number) {
  const waso = clamp01(1 - (awakeMinutes - 20) / 60);
  const wakes = clamp01(1 - (wakeCount - 2) / 8);
  return 20 * (0.75 * waso + 0.25 * wakes);
}

export function scoreNight(s: Pick<SleepSession, 'onset' | 'asleepMs' | 'awakeMs' | 'wakeCount'>, previousOnsets: Date[]): SleepScore {
  const duration = durationPoints(s.asleepMs / HOUR);
  const consistency = consistencyPoints(s.onset, previousOnsets.slice(-13));
  const interruptions = interruptionPoints(s.awakeMs / MIN, s.wakeCount);
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    total: Math.round(duration + consistency + interruptions),
    duration: r(duration),
    consistency: r(consistency),
    interruptions: r(interruptions),
    consistencyBaselineNights: Math.min(13, previousOnsets.length),
  };
}

/** Apple's published tiers. */
export function scoreLabel(score: number) {
  if (score >= 96) return 'Very High';
  if (score >= 81) return 'High';
  if (score >= 61) return 'OK';
  if (score >= 41) return 'Low';
  return 'Very Low';
}
