import { AppHeader } from '@/components/AppHeader';
import { RequireAuth } from '@/components/RequireAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4">
        <AppHeader />
        <main className="flex-1">{children}</main>
      </div>
    </RequireAuth>
  );
}
