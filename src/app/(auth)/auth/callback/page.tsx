'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const finalize = async () => {
      const supabase = getBrowserSupabaseClient();
      await supabase.auth.getSession();
      router.replace('/');
    };

    finalize();
  }, [router]);

  return <div className="p-6 text-sm text-slate-600">Finalizing login…</div>;
}
