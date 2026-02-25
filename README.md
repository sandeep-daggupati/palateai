# Dish Tracker (PalateAI MVP)

Dish Tracker is a mobile-first Next.js PWA for personal dish logging using receipt/menu uploads, async extraction, review, and approval into a personal dish history.

## Stack

- Next.js 14+ App Router + TypeScript (strict)
- Tailwind CSS
- Supabase (Auth, Postgres, Storage)
- browser-image-compression
- PWA metadata (manifest + icons)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file and fill values:
   ```bash
   cp .env.example .env.local
   ```
3. Start development server:
   ```bash
   npm run dev
   ```

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_PLACES_API_KEY` (server-only; do not prefix with `NEXT_PUBLIC`)

## Supabase auth notes

- Enable Google provider in Supabase Auth.
- Add redirect URLs for your environments, e.g.:
  - `http://localhost:3000/auth/callback`
  - `https://<your-domain>/auth/callback`

## Project structure

- `src/app/(auth)/login` - OAuth login screen
- `src/app/(auth)/auth/callback` - session finalization redirect
- `src/app/(app)` - authenticated app pages (`/`, `/add`, `/uploads/[id]`, `/dishes/[dishKey]`)
- `src/app/api/extract` - extraction API route
- `src/app/api/approve` - approve API route
- `src/app/api/places/autocomplete` - server-side Places autocomplete
- `src/app/api/places/details` - server-side Place details
- `src/app/api/places/sync` - cached Place directory enrichment sync
- `src/lib/supabase` - browser and server clients
- `src/lib/storage` - image/audio upload helpers
- `src/lib/extraction` - OpenAI vision extraction helpers

## Database expectations

This MVP expects these tables in Supabase:

- `restaurants`
- `receipt_uploads`
- `extracted_line_items`
- `dish_entries`

And one storage bucket:

- `uploads`

## Google Places Setup

1. In Google Cloud, enable Places API (Web Service).
2. Create an API key restricted for server usage.
3. Add `GOOGLE_PLACES_API_KEY` in local `.env.local` and Vercel env vars.
4. All Places calls are server-side routes so the key is not exposed in the browser.

## Migration for Places + Visit Location

Run the SQL in `supabase/migrations/20260221_places_location.sql` in your Supabase SQL editor.

It adds:

- `restaurants.place_id` + `restaurants.address` + `restaurants.lat` + `restaurants.lng`
- unique index on `(user_id, place_id)` for stable place identity
- `receipt_uploads.visit_lat` + `receipt_uploads.visit_lng`

## Migration for Visit + Analytics Support

Run the SQL in `supabase/migrations/20260221_analytics_support.sql` in your Supabase SQL editor.

It adds and backfills:

- `receipt_uploads.visited_at`
- `dish_entries.eaten_at`
- `dish_entries.dish_key` (if missing)

And indexes for analytics:

- `dish_entries(user_id, eaten_at desc)`
- `dish_entries(user_id, restaurant_id)`
- `dish_entries(user_id, dish_key)`
- `receipt_uploads(user_id, visited_at desc)`

## Visit Definition

A restaurant visit is the latest `receipt_uploads` row for a user where `restaurant_id` is not null.

For Home page recency, visits are ordered by:

1. `visited_at` descending
2. `created_at` descending fallback

The "Recent Restaurant Visits" list links each visit to `/uploads/[id]` and shows status plus extracted item count.

## Migration for Shared Visits

Run the SQL in `supabase/migrations/20260222_shared_visits.sql` in your Supabase SQL editor.

It adds:

- `receipt_uploads.is_shared` and `receipt_uploads.share_visibility`
- `visit_participants` table for private participant membership/invites
- `dish_entries.had_it` for per-user dish participation
- indexes for participant lookups and per-user-per-visit dish upserts

MVP behavior:

- Visits are private and visible to host + active participants.
- Dishes are shared by default; each user saves their own identity, note, and `had_it` state.
## Migration for Dish Identity System

Run the SQL in `supabase/migrations/20260222_dish_identity.sql` in your Supabase SQL editor.

It adds:

- enum type `dish_identity` with values: `go_to`, `hidden_gem`, `special_occasion`, `try_again`, `never_again`
- `dish_entries.identity_tag` using that enum

Notes:

- `dish_entries.rating` is intentionally kept for backward compatibility.
- The UI now uses `identity_tag` instead of numeric rating.
## Migration for Ratings + Visit Notes

Run the SQL in `supabase/migrations/20260221_ratings_visit_notes.sql` in your Supabase SQL editor.

It adds:

- `extracted_line_items.rating` (1-5) and `extracted_line_items.comment`
- `receipt_uploads.visit_rating` (1-5) and `receipt_uploads.visit_note`
- `dish_entries.rating` (1-5) and `dish_entries.comment`

Approval flow behavior:

1. User edits line items + identity tags + notes on `/uploads/[id]`
2. `Approve & Save` writes visit feedback to `receipt_uploads`
3. `Approve & Save` writes dish feedback to `extracted_line_items`
4. `/api/approve` creates `dish_entries` and copies identity_tag/comment per dish






## Demo Data Strategy (Professional Seed)

This project supports a dedicated demo seed workflow that writes to real production tables while keeping data isolated to one demo account.

### Why this approach

- Uses real schema and app queries (no mock layer).
- Seeds only one dedicated user to avoid polluting real accounts.
- Uses `seed_tag` on core tables for safe wipe/reseed.
- Requires explicit guard flags to prevent accidental production writes.
- Generates realistic 90-day patterns so Home dashboard, Dishes/Hangouts tabs, and Ask intents all have meaningful data.

### Required env vars for seeding

Add these in `.env.local` (and Vercel Preview env if needed):

- `DEMO_SEED_ENABLED=true`
- `DEMO_SEED_TAG=demo_seed_v1`
- `DEMO_USER_ID=<demo-user-uuid>` (required)
- `BUDDY_USER_IDS=<buddy-uuid-1,buddy-uuid-2>` (optional)
- `DEMO_USER_EMAIL=demo@palateai.local` (for login docs/display only)
- `SUPABASE_URL=<your-supabase-url>`
- `SUPABASE_SECRET_KEY=<service-role-key>`
- `ALLOW_PROD_SEED=false`

Notes:

- Keep service role key server-side only.
- Do not use `NEXT_PUBLIC_*` for the service role key.
- Script aborts when `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`.

### Required migrations before seeding

Run these migrations first:

- `supabase/migrations/20260224_demo_seed_tags.sql`
- `supabase/migrations/20260224_daily_insights.sql`
- `supabase/migrations/20260224_daily_insights_category_rotation.sql`

`20260224_demo_seed_tags.sql` adds `seed_tag` columns to:

- `restaurants`
- `receipt_uploads`
- `dish_entries`
- `visit_participants`
- `extracted_line_items`

### Seed commands

- Seed demo data:
  ```bash
  npm run seed:demo
  ```
- Wipe demo seed data only:
  ```bash
  npm run seed:demo:wipe
  ```

Implementation file:

- `scripts/seed_demo.js`

### What gets seeded

For the dedicated demo user:

- `profiles` (demo + optional buddy users)
- `restaurants` (upsert only)
- `receipt_uploads` (30 hangouts over ~90 days, realistic skew)
- `extracted_line_items` (line-item truth with quantity/unit_price coverage)
- `dish_entries` (identity tags, ratings, had_it variance)
- `visit_participants` (crew on shared hangouts)

Pattern goals included in seed:

- Last 14 days has denser activity.
- `Popeyes` appears repeatedly in recent range.
- Sushi spot repeats in mid-range.
- One new place appears inside last 30 days.
- Quantity and pricing are present often enough for spend insights.

### Idempotency and safety

The script is rerunnable and deterministic:

1. Resolves demo/buddy users by explicit UUID env vars (no user scanning).
2. Upserts profiles.
3. Wipes only demo-scoped seed data in strict dependency order:
   - `extracted_line_items`
   - `visit_participants`
   - `dish_entries`
   - `daily_insights`
   - `receipt_uploads`
4. Upserts restaurants and inserts fresh demo data.

The wipe intentionally does **not** delete restaurants to avoid FK/shared-reference issues.

### Demo login

The demo email/password is only for the dedicated demo account used for previews.
Regular users should continue signing in with Google OAuth.\n\nPreview/local email-password login can be enabled with NEXT_PUBLIC_DEMO_AUTH=true for QA of seeded demo accounts only.\nProduction should keep NEXT_PUBLIC_DEMO_AUTH=false (Google-only UX).

Demo credentials are:

- email: `DEMO_USER_EMAIL`
- password: your configured demo account password

### Validation checklist after seeding

- Home shows:
  - `For you today` insight
  - `Your highlights` (3 mini cards)
  - `Recent hangouts` chips
- `/dishes` is populated and filters work.
- `/hangouts` is populated and status/restaurant filtering works.
- Ask PalateAI responds with meaningful answers for:
  - favorite dish
  - last hangout (e.g., Popeyes)
  - hangout recap follow-up
  - most visited restaurant
  - cheapest logged item (e.g., nuggets)
- Crew names show display names (no UUIDs).

### Vercel preview usage

For preview demos:

1. Set the same demo env vars in Vercel Preview environment.
2. Run `npm run seed:demo` from a secure workflow (CI job or trusted environment).
3. Use the dedicated demo login for QA and product walkthroughs.



