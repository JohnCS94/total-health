# Health

Personal, single-user health tracker: an iPhone app that pulls in Apple Health (food from Lose It, weight,
sleep, water, workouts) and Hevy, a Supabase backend, and a dashboard website. No accounts or logins.

```
apps/mobile          Expo (React Native) iPhone app: Apple Health + Hevy sync, sleep score, manual weight/water/workouts
apps/web             Next.js dashboard for Vercel: charts and tables
supabase/migrations  Database schema + access rules
```

## How access works

There are no logins. The database requires a secret **app token** (a long random string generated inside
your database) on every request. Without it, even someone holding your publishable key sees nothing.

| Who | Holds the token |
|---|---|
| iPhone app | baked into the app on your phone (`apps/mobile/.env.local`) |
| Website | Vercel **server** env var. Never sent to the browser |

The website is protected by a single **passphrase** (`DASHBOARD_PASSPHRASE`). Enter it once per device and
the dashboard stays unlocked for 90 days (httpOnly cookie); **Lock** in the header signs that device out,
and changing the passphrase signs out every device. `/?demo` (sample data) stays public.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor**: run the migrations in order: `0001_init.sql`, `0002_single_user.sql`, `0003_hevy.sql`,
   `0004_remove_insights.sql`, `0005_sleep_score.sql`, `0006_food_from_health.sql`.
   The second one prints **your app token**. Copy it. (View it again any time with
   `select token from private.app_token;`)
3. **Project Settings → API keys**: copy the project URL and the **publishable** key.

To rotate the token later: `update private.app_token set token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');`,
then update it in both places below.

## 2. iPhone app

```sh
cd apps/mobile
cp .env.example .env.local   # Supabase URL, publishable key, APP TOKEN, Hevy key
npm install
npx expo run:ios --device    # first install / after native changes
npx expo start --clear       # day-to-day: serves JS changes to the installed app
```

First install: plug in your iPhone, enable **Developer Mode** (Settings → Privacy & Security), set a
unique `ios.bundleIdentifier` in `app.json`, run the command above, pick your signing team in Xcode if
asked (`ios/Health.xcworkspace` → Signing & Capabilities), then trust the certificate on the phone
(Settings → General → VPN & Device Management).

> With a free Apple ID, self-installed apps expire after 7 days and may have restricted capabilities.
> The $99/yr Apple Developer Program gives 1-year installs and full HealthKit support.

**Apple Health:** reads food, weight, sleep (incl. deep/REM), water and workouts; writes weight and water
you log manually. Syncs on every app open and pull-to-refresh; Settings has "Sync 30 days / 1 year" for
backfill.

**Food (Lose It):** log food in Lose It with its Apple Health connection on (Lose It → Settings → Apps &
Devices → Apple Health). Each food Lose It writes to Health is imported with its name, calories and macros;
edits and deletions in Lose It carry over on the next sync. On days with imported food, older entries made
in this app are replaced so meals aren't counted twice. Meals are taken from Lose It's metadata when
present, otherwise from the time of day.

**Sleep score:** calculated per night from Apple Health sleep data: duration 50 + bedtime consistency 30
+ interruptions 20 (Apple's published structure). Details in `apps/mobile/src/lib/sleepScore.ts`.

## 3. Website (Vercel)

```sh
cd apps/web
cp .env.example .env.local   # SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, APP_TOKEN, DASHBOARD_PASSPHRASE
npm install
npm run dev                  # http://localhost:3000  (/?demo shows sample data)
```

On Vercel, add the same four variables under **Settings → Environment Variables**. They have **no**
`NEXT_PUBLIC_` prefix, so they stay server-side. Then redeploy. The dashboard refreshes every minute.

## 4. Hevy

Add your Hevy API key (hevy.com → Settings → Developer; requires Hevy Pro) as `EXPO_PUBLIC_HEVY_API_KEY`
in `apps/mobile/.env.local`, then tap **Settings → Sync Hevy** in the app whenever you want to pull
workouts. The first sync imports your whole history; later syncs fetch only new, edited and deleted
workouts. They're stored in `hevy_workouts` + `hevy_sets`. Hevy session time counts as *Strength* in the
website's Training volume chart, and Hevy's own copies in Apple Health are skipped so nothing is counted twice.

## Data sources

- **Food:** Lose It via Apple Health · **Lifting:** Hevy API
- Values are stored metric; the units toggle in Settings changes display only.
