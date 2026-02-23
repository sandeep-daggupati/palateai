import { describe, expect, it } from 'vitest';
import { classifyHeuristic } from '@/lib/ask/classify';
import { ASK_INTENT_FIXTURES } from '@/lib/ask/fixtures/intentFixtures';

describe('Ask intent classification fixtures', () => {
  for (const fixture of ASK_INTENT_FIXTURES) {
    it(fixture.name, () => {
      const classification = classifyHeuristic(fixture.question);
      expect(classification.intent).toBe(fixture.expectedIntent);
    });
  }

  it('uses hangout context signal for follow-up recap phrases', () => {
    const classification = classifyHeuristic('What did I order?');
    expect(classification.intent).toBe('hangout_recap');
    expect(classification.params.use_context_hangout).toBe(true);
  });

  it('marks unsupported recommendation requests', () => {
    const classification = classifyHeuristic('Recommend places near me');
    expect(classification.intent).toBe('unsupported');
  });
});
