import { AskContext, AskIntent } from '@/lib/ask/types';

export type AskIntentFixture = {
  name: string;
  question: string;
  context: Partial<AskContext>;
  expectedIntent: AskIntent;
};

export const ASK_INTENT_FIXTURES: AskIntentFixture[] = [
  {
    name: 'last hangout by restaurant',
    question: 'When was my last hangout at Popeyes?',
    context: {},
    expectedIntent: 'last_hangout',
  },
  {
    name: 'follow-up order recap from context hangout',
    question: 'What did I order?',
    context: { lastHangoutId: '00000000-0000-0000-0000-000000000001' },
    expectedIntent: 'hangout_recap',
  },
  {
    name: 'favorite dish',
    question: "What's my favorite food?",
    context: {},
    expectedIntent: 'favorite_dish',
  },
  {
    name: 'cheapest logged item from personal logs',
    question: 'Where can I find chicken nuggets for cheap?',
    context: {},
    expectedIntent: 'cheapest_logged_item',
  },
  {
    name: 'unsupported recommendation request',
    question: 'Recommend places near me',
    context: {},
    expectedIntent: 'unsupported',
  },
];
