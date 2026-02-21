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
- `SUPABASE_SERVICE_ROLE_KEY`

## Supabase auth notes

- Enable Google provider in Supabase Auth.
- Add redirect URLs for your environments, e.g.:
  - `http://localhost:3000/auth/callback`
  - `https://<your-domain>/auth/callback`

## Project structure

- `src/app/(auth)/login` - OAuth login screen
- `src/app/(auth)/auth/callback` - session finalization redirect
- `src/app/(app)` - authenticated app pages (`/`, `/add`, `/uploads/[id]`, `/dishes/[dishKey]`)
- `src/app/api/extract` - extraction API route (stubbed architecture)
- `src/app/api/approve` - approve API route
- `src/lib/supabase` - browser and server clients
- `src/lib/storage` - image/audio upload helpers
- `src/lib/extraction` - deterministic extraction stub service

## Database expectations

This MVP expects these tables in Supabase:

- `restaurants`
- `receipt_uploads`
- `extracted_line_items`
- `dish_entries`

And one storage bucket:

- `uploads`
