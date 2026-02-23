import { classifyHeuristic } from '@/lib/ask/classify';
import { ASK_INTENT_FIXTURES } from '@/lib/ask/fixtures/intentFixtures';

export function runAskIntentFixtureCheck(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const fixture of ASK_INTENT_FIXTURES) {
    const classification = classifyHeuristic(fixture.question);
    if (classification.intent === fixture.expectedIntent) {
      passed += 1;
      continue;
    }

    failed += 1;
    failures.push(`${fixture.name}: expected ${fixture.expectedIntent}, got ${classification.intent}`);
  }

  return { passed, failed, failures };
}
