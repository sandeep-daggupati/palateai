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
- `GOOGLE_MAPS_API_KEY` (server-only; do not prefix with `NEXT_PUBLIC`)

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
3. Add `GOOGLE_MAPS_API_KEY` in local `.env.local` and Vercel env vars.
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





