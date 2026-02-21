import { AppHeader } from '@/components/AppHeader';
import { RequireAuth } from '@/components/RequireAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-5">
        <AppHeader />
        <main className="flex-1">{children}</main>
      </div>
    </RequireAuth>
  );
}
