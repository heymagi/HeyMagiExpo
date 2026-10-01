/**
 * MAGI response taxonomy.
 *
 * Derived from magi_complete_training_dataset_5000plus.xlsx. That file contains
 * 70,400 rows, but they are a combinatorial expansion of 80 base intents crossed
 * with 10 neurotypes x 8 hormone phases x 11 age groups. The 80 intents below are
 * the entire signal; the expansion adds no information and its generated context
 * suffixes are frequently incoherent (e.g. "postmenopause ... dealing with puberty").
 *
 * IMPORTANT: the dataset's `crisis_level` column is NOT a safety severity. It labels
 * "I can't concentrate today" as Medium and "my period is making everything harder"
 * as High. Using it to trigger escalation would escalate 52,000 of 70,400 ordinary
 * bad days. It is imported here as `needIntensity` (how much support to offer) and is
 * deliberately kept separate from risk assessment, which lives in ./risk.ts.
 */

import { INTENT_RECORDS } from './intents.generated.ts';

export const SCENARIO_CATEGORIES = [
  'focus_attention',
  'emotional_regulation',
  'crisis_support',
  'hormone_impact',
  'social_interpersonal',
  'sensory_overload',
  'executive_function',
  'work_school',
  'identity_masking',
  'success_positive',
] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

export const NEUROTYPES = [
  'ADHD-Inattentive',
  'ADHD-Hyperactive',
  'ADHD-Combined',
  'Autism',
  'ADHD-Autism',
  'PDA',
  'Dyslexia-ADHD',
  'Dyspraxia',
  'Sensory Processing Disorder',
  'OCD-ADHD',
] as const;
export type Neurotype = (typeof NEUROTYPES)[number];

export const HORMONE_PHASES = [
  'Menstrual',
  'Follicular',
  'Ovulatory',
  'Luteal',
  'Premenstrual',
  'PMDD-Luteal',
  'Perimenopause',
  'Postmenopause',
] as const;
export type HormonePhase = (typeof HORMONE_PHASES)[number];

export const DBT_SKILLS = [
  'Mindfulness-Observe',
  'Mindfulness-Describe',
  'Mindfulness-Participate',
  'Distress_Tolerance-ACCEPTS',
  'Distress_Tolerance-TIPP',
  'Distress_Tolerance-Radical_Acceptance',
  'Emotion_Regulation-Check_Facts',
  'Emotion_Regulation-Opposite_Action',
  'Emotion_Regulation-PLEASE',
  'Interpersonal-DEAR_MAN',
  'Interpersonal-FAST',
  'Interpersonal-GIVE',
] as const;
export type DbtSkill = (typeof DBT_SKILLS)[number];

export const RESPONSE_TONES = [
  'validating_supportive',
  'encouraging_educational',
  'crisis_supportive',
  'positive_reinforcing',
] as const;
export type ResponseTone = (typeof RESPONSE_TONES)[number];

/** How much support to offer. Not a risk level. See ./risk.ts for risk. */
export type NeedIntensity = 1 | 2 | 3 | 4 | 5;

export interface Intent {
  id: string;
  phrase: string;
  category: ScenarioCategory;
  needIntensity: NeedIntensity;
  /** The original dataset label, retained only for traceability. Do not branch on it. */
  sourceCrisisLevel: string;
  dbtSkill: DbtSkill;
  tone: ResponseTone;
  /** Whether a body-based (somatic) suggestion is appropriate for this intent. */
  somatic: boolean;
}

export const INTENTS = INTENT_RECORDS as unknown as Intent[];

export const INTENTS_BY_ID: Record<string, Intent> = Object.fromEntries(
  INTENTS.map((i) => [i.id, i]),
);

export function intentsInCategory(category: ScenarioCategory): Intent[] {
  return INTENTS.filter((i) => i.category === category);
}

/**
 * Plain-language guidance for each DBT skill, written for a neurodivergent reader.
 * MAGI is given these as reference material; she never names the skill clinically
 * unless the user has asked her to.
 */
export const DBT_SKILL_GUIDANCE: Record<DbtSkill, { plainName: string; how: string }> = {
  'Mindfulness-Observe': {
    plainName: 'noticing without fixing',
    how: 'Invite her to notice one thing happening right now — a sound, a texture, where her breath sits — without deciding what it means or what to do about it.',
  },
  'Mindfulness-Describe': {
    plainName: 'putting words to it',
    how: 'Help her name what is happening in flat, factual words. "My chest is tight and my thoughts are fast" rather than "I am falling apart".',
  },
  'Mindfulness-Participate': {
    plainName: 'getting absorbed in one thing',
    how: 'Suggest one small absorbing action she can drop fully into, without splitting attention or monitoring how well it is going.',
  },
  'Distress_Tolerance-ACCEPTS': {
    plainName: 'getting through the next bit',
    how: 'Offer a way to take up space in her attention until the intensity drops — a distraction, a task, something absorbing. The aim is passing time safely, not solving anything.',
  },
  'Distress_Tolerance-TIPP': {
    plainName: 'changing your body chemistry fast',
    how: 'Offer a fast physical shift: cold water on the face or wrists, a hard burst of movement, slow breathing with a long exhale, or deliberately tensing then releasing muscles. Use when the nervous system is too activated to think.',
  },
  'Distress_Tolerance-Radical_Acceptance': {
    plainName: 'stopping the fight with reality',
    how: 'Acknowledge the situation as it actually is, without requiring her to like it or approve of it. Never imply she should be fine with it.',
  },
  'Emotion_Regulation-Check_Facts': {
    plainName: 'checking what you know',
    how: 'Gently separate what happened from what it might mean. Only ever an invitation — never a correction of how she feels.',
  },
  'Emotion_Regulation-Opposite_Action': {
    plainName: 'doing the small opposite thing',
    how: 'Suggest one small action that runs against what the emotion is urging, sized so it is actually possible right now.',
  },
  'Emotion_Regulation-PLEASE': {
    plainName: 'looking after the basics',
    how: 'Check the physical floor under the feeling — food, water, sleep, pain, medication. Offer this as information, never as a reprimand for not having managed it.',
  },
  'Interpersonal-DEAR_MAN': {
    plainName: 'asking for what you need',
    how: 'Help her build a clear ask: what happened, how it landed, what she wants, why it helps. Offer to draft the actual words.',
  },
  'Interpersonal-FAST': {
    plainName: 'holding your ground',
    how: 'Help her say her piece without apologising for existing or conceding what matters. Useful when she is being disbelieved.',
  },
  'Interpersonal-GIVE': {
    plainName: 'keeping the relationship intact',
    how: 'Help her stay in the conversation without abandoning herself — interested, gentle, validating of the other person, while still being honest.',
  },
};

export const TONE_GUIDANCE: Record<ResponseTone, string> = {
  validating_supportive:
    'Lead with recognition. Name what she is carrying before offering anything. Do not rush to a suggestion; one small offer at the end, framed as optional.',
  encouraging_educational:
    'Warm and matter-of-fact. It is fine to explain a mechanism briefly if it removes shame. Keep it short and offer one concrete next step.',
  crisis_supportive:
    'Short sentences. Present tense. One thing at a time. No explaining, no analysis, no questions she has to think hard to answer. Stay with her body and the next few minutes.',
  positive_reinforcing:
    'Reflect back specifically what she did, not a generic well done. Attribute it to her, not to luck or to MAGI. Do not immediately pivot to the next challenge.',
};

export const CATEGORY_LABELS: Record<ScenarioCategory, string> = {
  focus_attention: 'Focus and attention',
  emotional_regulation: 'Emotional regulation',
  crisis_support: 'Acute distress',
  hormone_impact: 'Hormones and cycle',
  social_interpersonal: 'People and relationships',
  sensory_overload: 'Sensory load',
  executive_function: 'Executive function',
  work_school: 'Work and study',
  identity_masking: 'Identity and masking',
  success_positive: 'Wins and progress',
};
