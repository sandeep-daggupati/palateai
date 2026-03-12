import { Compass, Pizza } from 'lucide-react';
import { FlavorFingerprint } from '@/lib/home/getHomeOverview';

export function FlavorFingerprintCard({ fingerprint }: { fingerprint: FlavorFingerprint }) {
  return (
    <section className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <Pizza size={14} className="text-app-muted" />
          <p className="section-label">Your Flavor Fingerprint</p>
        </div>
        <Compass size={14} className="text-app-muted" />
      </div>

      <div className="space-y-1.5">
        {fingerprint.bars.slice(0, 4).map((bar) => (
          <div key={bar.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-app-muted">
              <span>{bar.label}</span>
              <span>{bar.value}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-app-bg">
              <div className="h-full rounded-full bg-app-primary transition-all duration-300" style={{ width: `${Math.max(8, bar.value)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-app-muted">{fingerprint.tagline}</p>
    </section>
  );
}
