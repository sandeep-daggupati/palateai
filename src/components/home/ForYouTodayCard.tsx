'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type InsightEvidenceType = 'dish' | 'restaurant' | 'hangout' | 'summary';

type InsightPayload = {
  category?: 'palate' | 'explore' | 'spend' | 'wildcard';
  insight_type?: string;
  insight_text: string;
  evidence_type?: InsightEvidenceType;
  evidence?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readCrewNames(evidence: Record<string, unknown>): string[] {
  const raw = evidence.crew_preview;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).display_name : null))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5);
}

function resolveHangoutPath(type: InsightEvidenceType, evidence: Record<string, unknown>): string | null {
  const raw = type === 'hangout' ? evidence.hangout_id : evidence.last_hangout_id;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return `/uploads/${raw}`;
}

export function ForYouTodayCard({ insight }: { insight: InsightPayload | null }) {
  const [open, setOpen] = useState(false);

  const evidence = useMemo(() => asRecord(insight?.evidence), [insight?.evidence]);
  const crewNames = useMemo(() => readCrewNames(evidence), [evidence]);
  const hangoutPath = useMemo(
    () => (insight && insight.evidence_type ? resolveHangoutPath(insight.evidence_type, evidence) : null),
    [evidence, insight],
  );
  const insightTypeLabel = insight?.insight_type ? insight.insight_type.replace(/_/g, ' ') : null;

  if (!insight) {
    return (
      <section className="card-surface p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">For you today</p>
          <span className="text-xs text-app-muted">Based on your logs</span>
        </div>
        <p className="text-sm text-app-muted">Your daily insight will show up after you log a few hangouts.</p>
      </section>
    );
  }

  return (
    <>
      <button type="button" className="card-surface w-full p-3 space-y-1.5 text-left" onClick={() => setOpen(true)}>
        <div className="flex items-center justify-between gap-3">
          <p className="section-label">For you today</p>
          <span className="text-xs text-app-muted">{insightTypeLabel ?? 'See details'}</span>
        </div>
        <p className="text-xs text-app-muted">Based on your logs</p>
        <p className="text-sm font-medium leading-5 text-app-text">{insight.insight_text}</p>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-3xl rounded-t-2xl border border-app-border bg-app-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-app-text">Why this?</h2>
              <button type="button" className="h-11 rounded-lg border border-app-border px-3 text-xs text-app-text" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <p className="mb-2 text-sm text-app-text">{insight.insight_text}</p>

            {insight.evidence_type === 'dish' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Food:</span> {typeof evidence.dish_name === 'string' ? evidence.dish_name : 'Unknown dish'}</p>
                <p><span className="text-app-muted">Count:</span> {typeof evidence.count === 'number' ? evidence.count : 0}</p>
                {typeof evidence.last_hangout_date === 'string' && <p><span className="text-app-muted">Last hangout:</span> {evidence.last_hangout_date}</p>}
                {crewNames.length > 0 && <p><span className="text-app-muted">Crew:</span> {crewNames.join(', ')}</p>}
              </div>
            )}

            {insight.evidence_type === 'restaurant' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Restaurant:</span> {typeof evidence.restaurant_name === 'string' ? evidence.restaurant_name : 'Unknown restaurant'}</p>
                <p><span className="text-app-muted">Hangouts:</span> {typeof evidence.hangout_count === 'number' ? evidence.hangout_count : 0}</p>
                {typeof evidence.last_hangout_date === 'string' && <p><span className="text-app-muted">Last hangout:</span> {evidence.last_hangout_date}</p>}
                {crewNames.length > 0 && <p><span className="text-app-muted">Crew:</span> {crewNames.join(', ')}</p>}
              </div>
            )}

            {insight.evidence_type === 'hangout' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Restaurant:</span> {typeof evidence.restaurant_name === 'string' ? evidence.restaurant_name : 'Unknown restaurant'}</p>
                <p><span className="text-app-muted">Date:</span> {typeof evidence.hangout_date === 'string' ? evidence.hangout_date : 'Unknown date'}</p>
                {typeof evidence.top_dish === 'string' && <p><span className="text-app-muted">Top dish:</span> {evidence.top_dish}</p>}
              </div>
            )}

            {insight.evidence_type === 'summary' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                {Array.isArray(evidence.metrics)
                  ? evidence.metrics.slice(0, 3).map((entry, index) => {
                      const row = asRecord(entry);
                      const label = typeof row.label === 'string' ? row.label : `Metric ${index + 1}`;
                      const value = typeof row.value === 'number' || typeof row.value === 'string' ? row.value : 0;
                      return (
                        <p key={`${label}-${index}`}>
                          <span className="text-app-muted">{label}:</span> {value}
                        </p>
                      );
                    })
                  : null}
              </div>
            )}

            {hangoutPath && (
              <div className="mt-2">
                <Link
                  href={hangoutPath}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
                  onClick={() => setOpen(false)}
                >
                  Open hangout
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

