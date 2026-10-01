/**
 * Loads everything MAGI needs to know before she answers.
 *
 * All reads go through a client built from the caller's JWT, so RLS is what stops one
 * user's context leaking into another's — not the correctness of the filters below. The
 * `.eq('account_id', accountId)` calls are belt as well as braces.
 *
 * Kept to a single round of parallel queries. This runs on every turn and latency is a
 * usability feature here: a woman mid-meltdown will not wait.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { guardianInvolvement, type RiskTier } from './risk.ts';
import type {
  MagiContext,
  MemoryRecord,
  OpenChallenge,
  ProfileRecord,
  RecentCheckIn,
  SafetyPlanRecord,
  TranscriptTurn,
} from './types.ts';

/** How much conversation to carry. Long enough to hold a thread, short enough to stay fast. */
const TRANSCRIPT_TURNS = 24;
const CHECK_IN_DAYS = 30;

const EMPTY_PROFILE: ProfileRecord = {
  preferred_name: null,
  pronouns: null,
  neurotypes: [],
  neurotype_note: null,
  hormone_context: [],
  tracks_cycle: false,
  typical_cycle_length_days: null,
  life_stage: null,
  health_conditions: [],
  support_style: 'warm',
  reminder_style: 'none',
  off_limits_topics: [],
  avoid_words: [],
  sensory_notes: null,
  onboarding_completed_at: null,
};

export async function loadContext(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string | null;
  localDate: string;
  timezone: string;
  /** Provisional tier from the lexicon, used only to decide guardian involvement up front. */
  provisionalTier: RiskTier;
}): Promise<MagiContext> {
  const { db, accountId, conversationId, localDate, timezone, provisionalTier } = args;

  const sinceDate = new Date(localDate);
  sinceDate.setDate(sinceDate.getDate() - CHECK_IN_DAYS);
  const since = sinceDate.toISOString().slice(0, 10);

  const [
    accountRes,
    profileRes,
    memoryRes,
    transcriptRes,
    challengeRes,
    checkInRes,
    safetyRes,
    subsRes,
    guardianRes,
    cycleRes,
  ] = await Promise.all([
    db.from('account').select('date_of_birth').eq('id', accountId).maybeSingle(),
    db.from('profile').select('*').eq('account_id', accountId).maybeSingle(),
    db
      .from('magi_memory')
      .select('id, kind, key, value, provenance, confidence, state')
      .eq('account_id', accountId)
      .in('state', ['active', 'needs_confirming'])
      .order('kind')
      .limit(120),
    conversationId
      ? db
          .from('message')
          .select('author, body, created_at')
          .eq('conversation_id', conversationId)
          .in('author', ['user', 'magi'])
          .order('created_at', { ascending: false })
          .limit(TRANSCRIPT_TURNS)
      : Promise.resolve({ data: [], error: null }),
    db
      .from('challenge_instance')
      .select('id, title, invitation, state, offered_at')
      .eq('account_id', accountId)
      .in('state', ['offered', 'accepted'])
      .order('offered_at', { ascending: false })
      .limit(5),
    db
      .from('check_in')
      .select('local_date, overall, note')
      .eq('account_id', accountId)
      .gte('local_date', since)
      .order('local_date', { ascending: false }),
    db.from('safety_plan').select('*').eq('account_id', accountId).maybeSingle(),
    db
      .from('signal_subscription')
      .select('signal_id')
      .eq('account_id', accountId)
      .eq('enabled', true),
    db
      .from('guardian_link')
      .select('id, state')
      .eq('minor_account_id', accountId)
      .eq('state', 'verified')
      .maybeSingle(),
    db.rpc('magi_cycle_day', { p_account: accountId, p_date: localDate }),
  ]);

  const dob: string | null = accountRes.data?.date_of_birth ?? null;
  const age = dob ? ageFrom(dob) : null;
  const isMinor = age != null && age < 18;

  const profile: ProfileRecord = profileRes.data
    ? { ...EMPTY_PROFILE, ...(profileRes.data as Partial<ProfileRecord>) }
    : EMPTY_PROFILE;

  const checkIns = (checkInRes.data ?? []) as RecentCheckIn[];

  // The transcript comes back newest-first for the LIMIT; the model needs oldest-first.
  const transcript = ((transcriptRes.data ?? []) as { author: string; body: string }[])
    .slice()
    .reverse()
    .map((m) => ({ author: m.author as TranscriptTurn['author'], body: m.body }));

  return {
    accountId,
    age,
    ageBand: dob ? bandFor(age!) : null,
    isMinor,
    guardianLinked: Boolean(guardianRes.data),
    guardianInvolvement: guardianInvolvement(age, provisionalTier),

    profile,
    memories: (memoryRes.data ?? []) as MemoryRecord[],
    transcript,
    openChallenges: (challengeRes.data ?? []) as OpenChallenge[],
    recentCheckIns: checkIns,
    checkedInToday: checkIns.some((c) => c.local_date === localDate),
    safetyPlan: (safetyRes.data as SafetyPlanRecord | null) ?? null,
    subscribedSignalIds: ((subsRes.data ?? []) as { signal_id: string }[]).map((s) => s.signal_id),
    cycleDay: typeof cycleRes.data === 'number' ? cycleRes.data : null,

    localDate,
    timezone,
  };
}

function ageFrom(dob: string): number {
  const birth = new Date(dob + 'T00:00:00Z');
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

/** Mirrors magi_age_band() in SQL. Kept in step deliberately; both are tested. */
function bandFor(age: number): string {
  if (age < 13) return 'under-13';
  if (age <= 15) return '13-15';
  if (age <= 18) return '16-18';
  if (age <= 21) return '19-21';
  if (age <= 25) return '22-25';
  if (age <= 29) return '26-29';
  if (age <= 34) return '30-34';
  if (age <= 39) return '35-39';
  if (age <= 44) return '40-44';
  if (age <= 49) return '45-49';
  if (age <= 55) return '50-55';
  return '56-65+';
}

export const __testables = { ageFrom, bandFor };
