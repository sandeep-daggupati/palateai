import { AppHeader } from '@/components/AppHeader';
import { AskPalateAI } from '@/components/AskPalateAI';
import { RequireAuth } from '@/components/RequireAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AppHeader />
        <main className="flex-1 space-y-4">{children}</main>
        <AskPalateAI />
      </div>
    </RequireAuth>
  );
}
