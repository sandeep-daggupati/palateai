'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

type AskContext = {
  lastRestaurantName?: string;
  lastRestaurantId?: string;
  lastPlaceId?: string;
  lastHangoutId?: string;
  lastDishName?: string;
  lastIntent?: string;
};

type AskMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type AskResponse = {
  ok: boolean;
  answer?: string;
  intent?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  contextUpdates?: AskContext;
  error?: string;
};

const SUGGESTED_QUESTIONS = [
  "What's my favorite dish?",
  'When was my last hangout at Popeyes?',
  "What are my GO-TOs lately?",
];

export function AskPalateAI() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [context, setContext] = useState<AskContext>({});

  const canAsk = question.trim().length > 0 && !loading;

  const title = useMemo(() => (loading ? 'Thinking...' : 'Ask PalateAI'), [loading]);

  const ask = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);

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

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: trimmed, context }),
      });

      const payload = (await response.json().catch(() => ({ ok: false, error: 'Could not process your question.' }))) as AskResponse;

      if (!response.ok || !payload.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: payload.error ?? 'Could not process your question.' }]);
        return;
      }

      if (payload.contextUpdates) {
        setContext((prev) => ({ ...prev, ...payload.contextUpdates }));
      }

      if (payload.needsClarification) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: payload.clarificationQuestion ?? "Which hangout do you mean? Try 'last hangout at Popeyes'.",
          },
        ]);
        return;
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: payload.answer ?? "I don't have that in your logs yet. Add a hangout and I'll learn." }]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async () => {
    await ask(question);
    setQuestion('');
  };

  const clearAll = () => {
    setQuestion('');
    setMessages([]);
    setContext({});
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
              {SUGGESTED_QUESTIONS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="rounded-full border border-app-border bg-app-card px-3 py-1.5 text-xs text-app-text"
                  onClick={() => {
                    setQuestion(chip);
                    void ask(chip);
                  }}
                  disabled={loading}
                >
                  {chip}
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
