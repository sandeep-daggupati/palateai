'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

type AskContext = {
  lastRestaurantName: string | null;
  lastRestaurantId: string | null;
  lastHangoutId: string | null;
  lastDishName: string | null;
  lastIntent: string | null;
};

type AskMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type CannedIntent = {
  intent: 'favorite_dish' | 'most_visited_restaurant' | 'last_hangout' | 'cheapest_item' | 'go_tos_lately';
  timeframe?: 'last_30_days' | 'last_60_days' | 'last_90_days' | null;
  source: 'canned';
};

type AskResponse = {
  answer: string;
  meta: {
    intent: string;
    confidence: number;
    used_context: {
      restaurant: boolean;
      hangout: boolean;
    };
    context_update: AskContext;
  };
};

const DEFAULT_CONTEXT: AskContext = {
  lastRestaurantName: null,
  lastRestaurantId: null,
  lastHangoutId: null,
  lastDishName: null,
  lastIntent: null,
};

const CANNED_ACTIONS: Array<{ label: string; intent: CannedIntent }> = [
  { label: '\u2764\uFE0F Favorite dish', intent: { intent: 'favorite_dish', timeframe: 'last_30_days', source: 'canned' } },
  { label: '\u{1F4CD} Last hangout', intent: { intent: 'last_hangout', timeframe: null, source: 'canned' } },
  { label: '\u{1F525} Most ordered lately', intent: { intent: 'go_tos_lately', timeframe: 'last_30_days', source: 'canned' } },
  { label: '\u{1F4B8} Cheapest logged item', intent: { intent: 'cheapest_item', timeframe: 'last_90_days', source: 'canned' } },
];

export function AskPalateAI() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [context, setContext] = useState<AskContext>(DEFAULT_CONTEXT);

  const canAsk = question.trim().length > 0 && !loading;
  const title = useMemo(() => (loading ? 'Thinking...' : 'Ask PalateAI'), [loading]);

  const requestAsk = async (payload: { source: 'free_form'; question: string } | { source: 'canned'; ask_intent: CannedIntent }, userText: string) => {
    if (loading) return;

    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    try {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const body =
        payload.source === 'free_form'
          ? { source: 'free_form', question: payload.question, context }
          : { source: 'canned', ask_intent: payload.ask_intent, context };

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({ error: 'Could not process your question.' }))) as { error?: string };
        setMessages((prev) => [...prev, { role: 'assistant', text: errorPayload.error ?? 'Could not process your question.' }]);
        return;
      }

      const result = (await response.json()) as AskResponse;
      setContext(result.meta?.context_update ?? DEFAULT_CONTEXT);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: result.answer || "I don't have that in your logs yet. Add a hangout and I'll learn.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    await requestAsk({ source: 'free_form', question: trimmed }, trimmed);
    setQuestion('');
  };

  const onCannedClick = async (action: (typeof CANNED_ACTIONS)[number]) => {
    await requestAsk({ source: 'canned', ask_intent: action.intent }, action.label);
  };

  const clearAll = () => {
    setQuestion('');
    setMessages([]);
    setContext(DEFAULT_CONTEXT);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-4 z-40 inline-flex h-12 items-center justify-center rounded-full border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text shadow-lg"
      >
        Ask
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-3xl rounded-t-2xl border border-app-border bg-app-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-app-text">{title}</h2>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" fullWidth={false} className="h-8 px-2 text-xs" onClick={clearAll}>
                  Clear
                </Button>
                <Button type="button" variant="ghost" size="sm" fullWidth={false} className="h-8 px-2 text-xs" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {CANNED_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="inline-flex h-9 items-center rounded-full border border-app-border bg-app-card px-3 text-xs font-medium text-app-text"
                  onClick={() => {
                    void onCannedClick(action);
                  }}
                  disabled={loading}
                >
                  {action.label}
                </button>
              ))}
            </div>

            <div className="mb-3 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-app-border p-3">
              {messages.length === 0 ? (
                <p className="text-sm text-app-muted">Ask about your logs. Follow-up questions in this sheet keep context.</p>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={`${msg.role}-${idx}`}
                    className={`rounded-xl px-3 py-2 text-sm ${
                      msg.role === 'user' ? 'bg-app-primary text-app-primary-text' : 'bg-app-card text-app-text border border-app-border'
                    }`}
                  >
                    {msg.text}
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about your hangouts, dishes, or GO-TOs"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canAsk) {
                    event.preventDefault();
                    void onSubmit();
                  }
                }}
              />
              <Button type="button" variant="primary" size="sm" fullWidth={false} className="h-10 px-3" onClick={() => void onSubmit()} disabled={!canAsk}>
                Ask
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

