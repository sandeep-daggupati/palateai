alter table public.hangout_summaries
  add column if not exists caption_text text,
  add column if not exists caption_source text,
  add column if not exists caption_generated_at timestamptz,
  add column if not exists caption_options jsonb;

alter table public.hangout_summaries
  drop constraint if exists hangout_summaries_caption_source_check;

alter table public.hangout_summaries
  add constraint hangout_summaries_caption_source_check
  check (caption_source is null or caption_source in ('openai', 'user', 'fallback'));

update public.hangout_summaries
set
  caption_text = coalesce(caption_text, summary_text),
  caption_source = coalesce(caption_source, 'openai'),
  caption_generated_at = coalesce(caption_generated_at, generated_at)
where summary_text is not null;
