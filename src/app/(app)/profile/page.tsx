'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

type ProfileState = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Failed to read file'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('id,display_name,avatar_url,email')
        .eq('id', user.id)
        .maybeSingle();

      const next = (data ?? {
        id: user.id,
        display_name: null,
        avatar_url: null,
        email: user.email ?? null,
      }) as ProfileState;

      setProfile(next);
      setDisplayName(next.display_name ?? '');
      setAvatarUrl(next.avatar_url ?? null);
      setLoading(false);
    };

    void load();
  }, []);

  const onSave = async () => {
    if (!profile) return;
    const nextDisplayName = displayName.trim();
    if (!nextDisplayName) return;

    setSaving(true);
    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: profile.id,
          display_name: nextDisplayName,
          avatar_url: avatarUrl,
          email: profile.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

    if (!error) {
      setProfile((current) =>
        current
          ? {
              ...current,
              display_name: nextDisplayName,
              avatar_url: avatarUrl,
            }
          : current,
      );
    }

    setSaving(false);
  };

  if (loading) {
    return <p className="empty-surface">Loading profile...</p>;
  }

  return (
    <div className="space-y-3 pb-6">
      <section className="card-surface space-y-1.5">
        <h1 className="text-xl font-semibold text-app-text">Profile</h1>
        <p className="text-sm text-app-muted">Manage your profile settings.</p>
      </section>

      <section className="card-surface space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-app-muted">Display name</p>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} placeholder="Display name" />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-app-muted">Email</p>
          <Input value={profile?.email ?? ''} readOnly disabled />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-app-muted">Avatar (optional)</p>
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <Image src={avatarUrl} alt="Avatar preview" width={56} height={56} className="h-14 w-14 rounded-full object-cover" unoptimized />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-app-bg text-xs text-app-muted">No photo</div>
            )}
            <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-app-border px-3 text-sm text-app-text">
              Upload avatar
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const dataUrl = await fileToDataUrl(file);
                  setAvatarUrl(dataUrl);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <Button type="button" onClick={onSave} disabled={saving || displayName.trim().length === 0}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </section>
    </div>
  );
}
