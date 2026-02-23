'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { ensureProfile } from '@/lib/profile/ensureProfile';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const finalize = async () => {
      const supabase = getBrowserSupabaseClient();
      await supabase.auth.getSession();
      await ensureProfile();
      router.replace('/');
    };

    void finalize();
  }, [router]);

  return <div className="p-4 text-sm text-app-muted">Finishing sign-in...</div>;
}

