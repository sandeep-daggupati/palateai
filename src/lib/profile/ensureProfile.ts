import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { TableInsert } from '@/lib/supabase/types';

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

function pickDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const metadata = user.user_metadata ?? {};
  const candidates = [metadata.full_name, metadata.name, metadata.user_name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  if (candidates.length > 0) return candidates[0];

  const email = user.email?.trim();
  if (!email) return null;
  const prefix = email.split('@')[0]?.trim();
  return prefix || null;
}

function pickAvatarUrl(user: { user_metadata?: Record<string, unknown> | null }): string | null {
  const metadata = user.user_metadata ?? {};
  const avatar = typeof metadata.avatar_url === 'string' ? metadata.avatar_url.trim() : '';
  if (avatar) return avatar;

  const picture = typeof metadata.picture === 'string' ? metadata.picture.trim() : '';
  return picture || null;
}

export async function ensureProfile(): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const nextDisplayName = pickDisplayName(user);
  const nextAvatarUrl = pickAvatarUrl(user);
  const nextEmail = user.email?.trim().toLowerCase() ?? null;

  const { data: existingRow } = await supabase
    .from('profiles')
    .select('id,display_name,avatar_url,email')
    .eq('id', user.id)
    .maybeSingle();

  const existing = (existingRow ?? null) as ProfileRow | null;
  const payload: TableInsert<'profiles'> = {
    id: user.id,
    updated_at: new Date().toISOString(),
  };

  if (!existing || !existing.display_name) {
    payload.display_name = nextDisplayName;
  }

  if (!existing || !existing.avatar_url) {
    payload.avatar_url = nextAvatarUrl;
  }

  if (!existing || !existing.email) {
    payload.email = nextEmail;
  }

  await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
}

