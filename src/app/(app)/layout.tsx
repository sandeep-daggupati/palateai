import Link from 'next/link';
import { RequireAuth } from '@/components/RequireAuth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col p-4">
        <header className="mb-4 flex items-center justify-between">
          <Link href="/" className="text-lg font-bold">
            Dish Tracker
          </Link>
          <Link
            href="/add"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            + Add
          </Link>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </RequireAuth>
  );
}
