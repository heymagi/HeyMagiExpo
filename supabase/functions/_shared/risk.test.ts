/**
 * Safety tests for the risk lexicon.
 *
 * Two failure modes matter and they are not symmetric. A missed escalation is the one that
 * hurts someone, so the recall cases below are treated as hard requirements. A false
 * escalation costs the user an unwanted phone number, so the precision cases assert only
 * that ordinary bad days do not reach the tiers that offer crisis resources.
 *
 * Run: deno test --config deno.json supabase/functions/_shared/risk.test.ts
 */

// node:assert rather than jsr:@std/assert so the suite runs with no network access.
import { ok, deepStrictEqual } from 'node:assert/strict';

const assert = (cond: unknown, msg?: string) => ok(cond, msg);
const assertEquals = <T>(actual: T, expected: T, msg?: string) =>
  deepStrictEqual(actual, expected, msg);
import {
  assessLexicon,
  highestTier,
  atLeast,
  RISK_PROTOCOL,
  guardianInvolvement,
  RISK_TIERS,
  type RiskTier,
} from './risk.ts';
import { INTENT_RECORDS } from './intents.generated.ts';

const rank = (t: RiskTier) => RISK_TIERS.indexOf(t);

/* ------------------------------------------------------------------ *
 * Recall — these must never be missed
 * ------------------------------------------------------------------ */

const MUST_BE_IMMINENT = [
  "I've taken all my tablets",
  "I have taken the pills",
  "I'm going to kill myself tonight",
  "I am about to end it",
  "I've written a note for my mum",
  "I'm on the bridge",
  "I'm cutting myself right now",
  "tonight I won't be here",
  "I have the blade here with me",
];

const MUST_BE_AT_LEAST_HIGH = [
  "I'm having suicidal thoughts",
  "I'm having thoughts of self-harm",
  'I want to die',
  "I don't want to be here anymore",
  'everyone would be better without me',
  'I keep thinking about hurting myself',
  "there's no point in carrying on",
  'I want it all to stop',
  "I can't do this anymore",
  'my family would be better off dead than dealing with me',
  "I've been thinking about suicide",
  'I want to disappear forever',
];

const MUST_BE_AT_LEAST_ELEVATED = [
  "I'm having a panic attack and I can't breathe",
  'I feel completely hopeless, there is no way out',
  "I can't cope anymore",
  "I don't feel safe at home",
  'my boyfriend is hurting me',
  "I haven't eaten in four days",
  "I'm dissociating, I'm watching myself from outside",
];

/* ------------------------------------------------------------------ *
 * Precision — ordinary distress must not reach resource-offering tiers
 * ------------------------------------------------------------------ */

const MUST_NOT_REACH_ELEVATED = [
  "I can't concentrate on anything today",
  'my brain feels foggy',
  "I'm hyperfocusing and lost three hours",
  'my period is making everything harder',
  "I'm exhausted from masking all day",
  'I need accommodations at work',
  "I'm procrastinating on important tasks",
  'the lights are hurting my eyes',
  'I accomplished something important today',
  'my boss doesn’t understand my needs',
  'ovulation makes me hypersensitive',
  "I'd rather die than sit through another team meeting",
  'I could kill my brother, he ate my lunch',
  'this deadline is killing me',
  "I'm dying to tell you what happened",
  'my phone battery is dead',
];

Deno.test('imminent risk is always caught', () => {
  for (const text of MUST_BE_IMMINENT) {
    const r = assessLexicon(text);
    assertEquals(r.tier, 'imminent', `expected imminent for: "${text}" (got ${r.tier})`);
  }
});

Deno.test('suicidal and self-harm ideation reaches at least high', () => {
  for (const text of MUST_BE_AT_LEAST_HIGH) {
    const r = assessLexicon(text);
    assert(
      atLeast(r.tier, 'high'),
      `expected >= high for: "${text}" (got ${r.tier}, reasons: ${r.reasons.join(',')})`,
    );
  }
});

Deno.test('acute distress reaches at least elevated', () => {
  for (const text of MUST_BE_AT_LEAST_ELEVATED) {
    const r = assessLexicon(text);
    assert(atLeast(r.tier, 'elevated'), `expected >= elevated for: "${text}" (got ${r.tier})`);
  }
});

Deno.test('ordinary bad days and figures of speech do not trigger crisis resources', () => {
  const failures: string[] = [];
  for (const text of MUST_NOT_REACH_ELEVATED) {
    const r = assessLexicon(text);
    if (atLeast(r.tier, 'elevated')) {
      failures.push(`"${text}" -> ${r.tier} via ${r.reasons.join(',')} [${r.matches.join('|')}]`);
    }
  }
  assertEquals(failures, [], `false escalations:\n  ${failures.join('\n  ')}`);
});

/* ------------------------------------------------------------------ *
 * Behaviour across the whole intent library
 * ------------------------------------------------------------------ */

Deno.test('the two genuine safety intents in the dataset are caught; the rest are not over-escalated', () => {
  const escalated: { phrase: string; tier: RiskTier }[] = [];
  for (const intent of INTENT_RECORDS) {
    const r = assessLexicon(intent.phrase);
    if (atLeast(r.tier, 'high')) escalated.push({ phrase: intent.phrase, tier: r.tier });
  }

  const phrases = escalated.map((e) => e.phrase).sort();
  assertEquals(
    phrases,
    ["I'm having suicidal thoughts", "I'm having thoughts of self-harm"].sort(),
    `unexpected set reaching >= high:\n  ${escalated.map((e) => `${e.tier}: ${e.phrase}`).join('\n  ')}`,
  );
});

Deno.test('the dataset severity label is not a risk signal', () => {
  // 45 of the 80 intents are labelled High/Crisis/Emergency by the source workbook. If those
  // labels drove escalation, over half of all ordinary turns would offer crisis resources.
  // This test documents the gap that justifies keeping risk assessment separate.
  const labelledSevere = INTENT_RECORDS.filter((i) =>
    ['High', 'Crisis', 'Emergency'].includes(i.sourceCrisisLevel),
  );
  const actuallyRisky = INTENT_RECORDS.filter((i) => atLeast(assessLexicon(i.phrase).tier, 'high'));

  assert(
    labelledSevere.length > 40,
    `expected the workbook to label >40 intents severe, got ${labelledSevere.length}`,
  );
  assertEquals(actuallyRisky.length, 2);
  assert(
    labelledSevere.length > actuallyRisky.length * 20,
    'the whole point of this test is that the label is far broader than real risk',
  );
});

/* ------------------------------------------------------------------ *
 * Context handling and tier mechanics
 * ------------------------------------------------------------------ */

Deno.test('historical and third-party context is flagged but never lowers the tier', () => {
  const historical = assessLexicon('I used to have thoughts of self-harm when I was younger');
  assert(atLeast(historical.tier, 'high'), 'tier must not be reduced by historical framing');
  assert(historical.possiblyHistoricalOrThirdParty, 'historical framing should be flagged');

  const thirdParty = assessLexicon('my sister has been having suicidal thoughts');
  assert(atLeast(thirdParty.tier, 'high'), 'tier must not be reduced for a third party');
  assert(thirdParty.possiblyHistoricalOrThirdParty, 'third-party framing should be flagged');

  const coursework = assessLexicon("I'm writing an essay about suicide prevention");
  assert(coursework.possiblyHistoricalOrThirdParty, 'coursework framing should be flagged');
});

Deno.test('highestTier never lowers a tier', () => {
  assertEquals(highestTier('none', 'imminent'), 'imminent');
  assertEquals(highestTier('imminent', 'none'), 'imminent');
  assertEquals(highestTier('high', 'monitor'), 'high');
  assertEquals(highestTier('none', null, undefined), 'none');
  assertEquals(highestTier('elevated', 'elevated'), 'elevated');
});

Deno.test('the protocol escalates monotonically', () => {
  const flags = [
    'offerResources',
    'includeEmergency',
    'suppressNonEssentialFeatures',
    'recordEvent',
    'pinSupportPanel',
    'guardianNotifyUnder16',
    'encourageTrustedAdult',
  ] as const;

  for (const flag of flags) {
    let seenTrue = false;
    for (const tier of RISK_TIERS) {
      const on = RISK_PROTOCOL[tier][flag];
      if (on) seenTrue = true;
      else if (seenTrue) {
        throw new Error(`${flag} switched back off at tier "${tier}" — protocol must be monotonic`);
      }
    }
  }
});

Deno.test('crisis tone and feature suppression start at the tier that offers resources', () => {
  assert(!RISK_PROTOCOL.none.recordEvent, 'no event for a normal turn');
  assert(RISK_PROTOCOL.monitor.suppressNonEssentialFeatures, 'monitor should already go quiet');
  assert(!RISK_PROTOCOL.monitor.offerResources, 'monitor must not push crisis resources');
  assert(RISK_PROTOCOL.elevated.offerResources, 'elevated should offer resources');
  assert(!RISK_PROTOCOL.elevated.includeEmergency, '999 is for imminent only');
  assert(RISK_PROTOCOL.imminent.includeEmergency, 'imminent must include 999');
  assert(
    rank('elevated') < rank('high') && rank('high') < rank('imminent'),
    'tier ordering must be stable',
  );
});

Deno.test('guardian involvement follows age and tier, never adults', () => {
  assertEquals(guardianInvolvement(14, 'imminent'), 'required');
  assertEquals(guardianInvolvement(14, 'high'), 'required');
  assertEquals(guardianInvolvement(14, 'elevated'), 'optional');
  assertEquals(guardianInvolvement(14, 'none'), 'optional');
  assertEquals(guardianInvolvement(17, 'high'), 'required');
  assertEquals(guardianInvolvement(19, 'imminent'), 'none');
  assertEquals(guardianInvolvement(34, 'imminent'), 'none');
  assertEquals(guardianInvolvement(null, 'imminent'), 'none');
});

Deno.test('empty and junk input is safe', () => {
  assertEquals(assessLexicon('').tier, 'none');
  assertEquals(assessLexicon('   ').tier, 'none');
  assertEquals(assessLexicon('👍').tier, 'none');
  // Unicode normalisation must not let a lookalike slip past the lexicon.
  assert(atLeast(assessLexicon('I want to ﬁnd a way to kill myself').tier, 'high'));
});
