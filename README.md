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

## Migration for Ratings + Visit Notes

Run the SQL in `supabase/migrations/20260221_ratings_visit_notes.sql` in your Supabase SQL editor.

It adds:

- `extracted_line_items.rating` (1-5) and `extracted_line_items.comment`
- `receipt_uploads.visit_rating` (1-5) and `receipt_uploads.visit_note`
- `dish_entries.rating` (1-5) and `dish_entries.comment`

Approval flow behavior:

1. User edits line items + ratings + notes on `/uploads/[id]`
2. `Approve & Save` writes visit feedback to `receipt_uploads`
3. `Approve & Save` writes dish feedback to `extracted_line_items`
4. `/api/approve` creates `dish_entries` and copies rating/comment per dish
