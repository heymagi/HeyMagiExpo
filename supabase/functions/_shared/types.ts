/** Shared request/response and context types for the MAGI orchestrator. */

import type { RiskTier, GuardianInvolvement } from './risk.ts';
import type { CrisisResource } from './crisis-resources.ts';

export interface MagiRequestBody {
  /** Omit to start a new conversation. */
  conversation_id?: string;
  message: string;
  /** The user's local date, so "today" means their today. */
  local_date: string;
  /** IANA zone, e.g. 'Europe/London'. Used only for wording like "this morning". */
  timezone?: string;
  /**
   * Set when the user accepted or rejected a proposal card.
   *
   * The proposal travels with the round trip rather than being parked in a server-side
   * table: every confirmation-gated tool writes only rows the user already owns, and RLS
   * means a tampered payload can do nothing she could not do herself by tapping. The tool
   * name is still checked against the confirmation-gated list before anything is written.
   */
  resolve_proposal?: {
    proposal_id: string;
    tool: string;
    decision: 'accept' | 'reject';
    /** The proposal's input, including any edits the user made before accepting. */
    input: Record<string, unknown>;
  };
}

export interface MemoryRecord {
  id: string;
  kind: string;
  key: string;
  value: string;
  provenance: 'stated' | 'inferred' | 'observed';
  confidence: number;
  state: string;
}

export interface ProfileRecord {
  preferred_name: string | null;
  pronouns: string | null;
  neurotypes: string[];
  neurotype_note: string | null;
  hormone_context: string[];
  tracks_cycle: boolean;
  typical_cycle_length_days: number | null;
  life_stage: string | null;
  health_conditions: string[];
  support_style: 'brief' | 'warm' | 'practical' | 'curious';
  reminder_style: string;
  off_limits_topics: string[];
  avoid_words: string[];
  sensory_notes: string | null;
  onboarding_completed_at: string | null;
}

export interface OpenChallenge {
  id: string;
  title: string;
  invitation: string;
  state: string;
  offered_at: string;
}

export interface RecentCheckIn {
  local_date: string;
  overall: string | null;
  note: string | null;
}

export interface SafetyPlanRecord {
  warning_signs: string | null;
  what_helps: string | null;
  what_does_not_help: string | null;
  message_to_self: string | null;
  do_not_say: string[];
  contacts: unknown[];
}

export interface TranscriptTurn {
  author: 'user' | 'magi';
  body: string;
}

/** Everything the orchestrator knows before composing a reply. */
export interface MagiContext {
  accountId: string;
  age: number | null;
  ageBand: string | null;
  isMinor: boolean;
  guardianLinked: boolean;
  guardianInvolvement: GuardianInvolvement;

  profile: ProfileRecord;
  memories: MemoryRecord[];
  transcript: TranscriptTurn[];
  openChallenges: OpenChallenge[];
  recentCheckIns: RecentCheckIn[];
  checkedInToday: boolean;
  safetyPlan: SafetyPlanRecord | null;
  subscribedSignalIds: string[];
  cycleDay: number | null;

  localDate: string;
  timezone: string;
}

export interface RetrievalCandidate {
  id: string;
  phrase: string;
  category: string;
  need_intensity: number;
  dbt_skill: string;
  tone: string;
  somatic: boolean;
  similarity: number;
}

export interface RiskAssessment {
  tier: RiskTier;
  lexiconTier: RiskTier;
  lexiconReasons: string[];
  lexiconMatches: string[];
  possiblyHistorical: boolean;
  modelTier: RiskTier | null;
  modelRationale: string | null;
  modelName: string | null;
}

/** A card the app renders inline in the conversation. */
export interface MagiCard {
  id: string;
  kind:
    | 'check_in_logged'
    | 'note_saved'
    | 'cycle_logged'
    | 'challenge'
    | 'challenge_updated'
    | 'memory_saved'
    | 'memory_removed'
    | 'history'
    | 'progress'
    | 'insight_proposal'
    | 'summary_proposal'
    | 'profile_proposal'
    | 'appearance_proposal'
    | 'support_resources'
    | 'safety_plan';
  /** Present when the card is awaiting a decision. */
  proposal?: {
    proposal_id: string;
    tool: string;
    input: Record<string, unknown>;
    accept_label: string;
    reject_label: string;
  };
  /** Card-specific payload. Shapes are documented per card in the app's card registry. */
  data: Record<string, unknown>;
  /** Read out by screen readers in place of the card's visual arrangement. */
  accessibleSummary: string;
}

export interface MagiResponse {
  conversation_id: string;
  message_id: string;
  reply: string;
  cards: MagiCard[];
  risk: {
    tier: RiskTier;
    pin_support_panel: boolean;
    resources: CrisisResource[];
    /** True when a guardian was or will be notified. The user is always told. */
    guardian_notified: boolean;
  };
  /** Set when MAGI suppressed features because of the risk tier, so the UI can go quiet too. */
  quiet_mode: boolean;
  debug?: {
    matched_intent_id: string | null;
    similarity: number | null;
    tone: string | null;
    dbt_skill: string | null;
    model: string;
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
  };
}
