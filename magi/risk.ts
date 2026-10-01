/**
 * Risk assessment — deliberately independent of the response taxonomy.
 *
 * Design principle: retrieval and "need intensity" decide how MAGI *speaks*. This
 * module decides whether a human needs to be involved. The two must never be conflated,
 * because the training data's severity labels are about support intensity, not danger.
 *
 * Two passes, and the higher result always wins:
 *   1. A deterministic lexicon pass (this file) — fast, offline, auditable, high recall.
 *   2. A model-based structured assessment run on every turn (see the magi edge function).
 *
 * The lexicon can only ever raise the tier, never lower it. A model that returns `none`
 * cannot override a lexicon hit. This is intentional: a false positive costs a user a
 * gently-offered phone number, a false negative costs considerably more.
 */

export const RISK_TIERS = ['none', 'monitor', 'elevated', 'high', 'imminent'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

const TIER_RANK: Record<RiskTier, number> = {
  none: 0,
  monitor: 1,
  elevated: 2,
  high: 3,
  imminent: 4,
};

export function highestTier(...tiers: (RiskTier | null | undefined)[]): RiskTier {
  return tiers.filter(Boolean).reduce<RiskTier>(
    (acc, t) => (TIER_RANK[t as RiskTier] > TIER_RANK[acc] ? (t as RiskTier) : acc),
    'none',
  );
}

export function atLeast(tier: RiskTier, floor: RiskTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor];
}

interface RiskPattern {
  tier: RiskTier;
  /** Matched case-insensitively against the normalised message. */
  patterns: RegExp[];
  /** Short machine-readable reason, stored on the risk event for audit. */
  reason: string;
}

/**
 * Ordered most-severe first. Matching stops collecting once every pattern is checked;
 * the highest tier matched is returned.
 *
 * These are intentionally broad. Under-matching is the dangerous failure mode.
 */
const RISK_PATTERNS: RiskPattern[] = [
  {
    tier: 'imminent',
    reason: 'stated_plan_or_act_in_progress',
    patterns: [
      /\b(i(?:'ve| have) (?:just )?(?:taken|swallowed|overdosed))\b/i,
      /\b(i(?:'m| am) (?:going to|about to) (?:kill myself|end (?:it|my life)|do it))\b/i,
      /\bi(?:'ve| have) (?:written|left) (?:a )?note\b/i,
      /\b(tonight|today|right now|in an hour)\b[^.?!]{0,40}\b(kill myself|end (?:it|my life)|not be here)\b/i,
      /\b(i have|i've got) (?:the )?(?:pills|tablets|rope|blade|knife)\b[^.?!]{0,30}\b(ready|here|with me)\b/i,
      /\bi(?:'m| am) (?:on|at) (?:the )?(?:bridge|roof|edge)\b/i,
      /\bi(?:'m| am) (?:cutting|hurting) myself (?:right )?now\b/i,
    ],
  },
  {
    tier: 'high',
    reason: 'suicidal_or_self_harm_ideation',
    patterns: [
      /\b(kill myself|killing myself|end my life|ending my life|take my own life)\b/i,
      /\b(suicidal|suicide)\b/i,
      /\b(want|wanting|going) to die\b/i,
      /\b(don'?t|do not) want to (?:be here|live|exist|wake up)\b/i,
      /\b(better off (?:dead|without me))\b/i,
      /\b(self[- ]?harm|self[- ]?harming|hurt myself|harm myself|cut myself|cutting myself)\b/i,
      /\b(everyone would be (?:happier|better) (?:if i|without me))\b/i,
      /\bi (?:can'?t|cannot) (?:do|keep doing) this any(?:more| longer)\b/i,
      /\bno (?:point|reason) (?:in )?(?:living|going on|carrying on|being here)\b/i,
      /\b(disappear|vanish) (?:forever|and never come back)\b/i,
      /\bi want (?:it|everything) to (?:stop|end)\b/i,
    ],
  },
  {
    tier: 'elevated',
    reason: 'acute_distress_or_safety_adjacent',
    patterns: [
      /\b(hopeless|no way out|trapped with no|nothing (?:will|can) help)\b/i,
      /\bi (?:can'?t|cannot) cope any ?more\b/i,
      /\b(complete|total) (?:breakdown|collapse)\b/i,
      /\b(starving myself|(?:haven'?t|not) eaten (?:in|for) (?:days|\d+ days))\b/i,
      /\b(?:someone|he|she|they) (?:is|are|was|were) (?:hurting|hitting|threatening) me\b/i,
      /\bi(?:'m| am) (?:not )?safe (?:at home|here|right now)\b/i,
      /\bi (?:don'?t|do not) feel safe\b/i,
      /\bpanic attack\b/i,
      /\b(dissociating|not (?:in|inside) my body|watching myself from outside)\b/i,
    ],
  },
  {
    tier: 'monitor',
    reason: 'distress_worth_watching',
    patterns: [
      /\b(?:completely|totally|utterly) (?:overwhelmed|broken|done)\b/i,
      /\bi (?:hate|can'?t stand) myself\b/i,
      /\b(worthless|useless|a burden|failing at everything)\b/i,
      /\b(shutdown|shut down|meltdown)\b/i,
      /\bcan'?t stop crying\b/i,
      /\bi(?:'m| am) drowning\b/i,
    ],
  },
];

/** Phrases that indicate the user is talking about the past, someone else, or a hypothetical. */
const DEESCALATING_CONTEXT = [
  /\b(?:used to|when i was (?:younger|a (?:kid|teen(?:ager)?)))\b/i,
  /\b(?:my (?:friend|sister|brother|mum|mother|dad|father|partner|colleague)|someone i know)\b[^.?!]{0,30}\b(?:is|was|has been)\b/i,
  /\b(?:i (?:used to|no longer|don'?t) (?:feel|think) (?:that|this) (?:way|any ?more))\b/i,
  /\b(?:years? ago|back (?:then|in \d{4})|in the past)\b/i,
  /\b(?:i'?m )?(?:writing|reading|watching) (?:a|about) (?:book|story|film|article|essay)\b/i,
];

export interface LexiconResult {
  tier: RiskTier;
  reasons: string[];
  /** Matched fragments, for the audit record. Never surfaced to the user. */
  matches: string[];
  /** True when de-escalating context was present. Lowers urgency of presentation, not the tier. */
  possiblyHistoricalOrThirdParty: boolean;
}

export function assessLexicon(message: string): LexiconResult {
  const text = message.normalize('NFKC').replace(/\s+/g, ' ');
  const reasons: string[] = [];
  const matches: string[] = [];
  let tier: RiskTier = 'none';

  for (const group of RISK_PATTERNS) {
    for (const re of group.patterns) {
      const m = text.match(re);
      if (m) {
        tier = highestTier(tier, group.tier);
        if (!reasons.includes(group.reason)) reasons.push(group.reason);
        matches.push(m[0]);
        break;
      }
    }
  }

  const possiblyHistoricalOrThirdParty =
    tier !== 'none' && DEESCALATING_CONTEXT.some((re) => re.test(text));

  return { tier, reasons, matches, possiblyHistoricalOrThirdParty };
}

/* ------------------------------------------------------------------ *
 * What MAGI must do at each tier
 * ------------------------------------------------------------------ */

export interface RiskProtocol {
  /** Offer UK crisis resources inside the reply. */
  offerResources: boolean;
  /** Include 999 / immediate-danger routing. */
  includeEmergency: boolean;
  /** Force `crisis_supportive` tone regardless of what retrieval suggested. */
  forceCrisisTone: boolean;
  /** Suppress challenges, streak-adjacent content, pattern insights and anything upbeat. */
  suppressNonEssentialFeatures: boolean;
  /** Write an auditable risk event row. */
  recordEvent: boolean;
  /** Surface the persistent, always-reachable support panel in the UI. */
  pinSupportPanel: boolean;
  /**
   * Notify a registered guardian. Only ever true for under-16s, and only at the top
   * tiers. The user is always told this is happening — never covertly.
   */
  guardianNotifyUnder16: boolean;
  /** Signpost the user toward telling a trusted adult / their GP, without notifying anyone. */
  encourageTrustedAdult: boolean;
}

export const RISK_PROTOCOL: Record<RiskTier, RiskProtocol> = {
  none: {
    offerResources: false,
    includeEmergency: false,
    forceCrisisTone: false,
    suppressNonEssentialFeatures: false,
    recordEvent: false,
    pinSupportPanel: false,
    guardianNotifyUnder16: false,
    encourageTrustedAdult: false,
  },
  monitor: {
    offerResources: false,
    includeEmergency: false,
    forceCrisisTone: false,
    suppressNonEssentialFeatures: true,
    recordEvent: true,
    pinSupportPanel: false,
    guardianNotifyUnder16: false,
    encourageTrustedAdult: false,
  },
  elevated: {
    offerResources: true,
    includeEmergency: false,
    forceCrisisTone: true,
    suppressNonEssentialFeatures: true,
    recordEvent: true,
    pinSupportPanel: true,
    guardianNotifyUnder16: false,
    encourageTrustedAdult: true,
  },
  high: {
    offerResources: true,
    includeEmergency: false,
    forceCrisisTone: true,
    suppressNonEssentialFeatures: true,
    recordEvent: true,
    pinSupportPanel: true,
    guardianNotifyUnder16: true,
    encourageTrustedAdult: true,
  },
  imminent: {
    offerResources: true,
    includeEmergency: true,
    forceCrisisTone: true,
    suppressNonEssentialFeatures: true,
    recordEvent: true,
    pinSupportPanel: true,
    guardianNotifyUnder16: true,
    encourageTrustedAdult: true,
  },
};

/**
 * Guardian involvement, per the rules implied by the dataset and by the ICO Age
 * Appropriate Design Code. Adults are never subject to guardian notification.
 */
export type GuardianInvolvement = 'none' | 'optional' | 'required';

export function guardianInvolvement(age: number | null, tier: RiskTier): GuardianInvolvement {
  if (age == null || age >= 19) return 'none';
  if (age <= 18 && atLeast(tier, 'high')) return 'required';
  if (age <= 18) return 'optional';
  return 'none';
}
