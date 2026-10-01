/**
 * MAGI's tool set.
 *
 * This file is what makes the product's central claim true: every function of the app runs
 * through MAGI. There is no "log a check-in" button that bypasses her, because there is no
 * second screen to put one on. She logs, she tracks, she remembers, she drafts, she
 * escalates — and each of those is a tool call whose result the UI renders as a card inside
 * the conversation.
 *
 * Three rules the tool design enforces:
 *
 *   1. Nothing irreversible without a tap. Tools that change what MAGI believes about the
 *      user, or that produce something the user will hand to a clinician, are marked
 *      `confirmation: 'required'`. The orchestrator returns them as *proposals*; the write
 *      only happens after the user accepts the card.
 *   2. MAGI cannot read another user. Every tool executes against a Supabase client built
 *      from the caller's JWT, so RLS is the enforcement boundary, not the tool code.
 *   3. MAGI cannot silence the safety layer. There is deliberately no tool to lower a risk
 *      tier, dismiss a risk event, or suppress the support panel.
 */

import type { LlmTool } from './llm.ts';

export type ConfirmationPolicy =
  /** Executes immediately; the card reports what happened and offers an undo. */
  | 'none'
  /** Returned as a proposal. Nothing is written until the user taps accept. */
  | 'required';

export interface ToolDefinition {
  name: string;
  description: string;
  confirmation: ConfirmationPolicy;
  /** Withheld from the model entirely while risk is elevated or higher. */
  suppressedInCrisis: boolean;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const overallValues = ['rough', 'low', 'ok', 'good', 'bright'] as const;

export const MAGI_TOOLS: ToolDefinition[] = [
  {
    name: 'log_check_in',
    description:
      "Record how the user is doing today. Use this whenever she tells you how she is, even in passing — she should not have to fill in a form. `overall` is the only thing that matters; everything else is optional. If she has already checked in today, this updates that entry rather than creating a second one. Never ask her to complete missing fields.",
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        overall: { type: 'string', enum: overallValues as unknown as string[] },
        note: {
          type: 'string',
          description: "Her own words, not your summary. Quote her where you can.",
        },
        signals: {
          type: 'array',
          description:
            'Any specific signals she mentioned. Only include ones she is subscribed to or that she just raised herself.',
          items: {
            type: 'object',
            properties: {
              signal_id: { type: 'string' },
              value_numeric: { type: 'number' },
              value_boolean: { type: 'boolean' },
              value_text: { type: 'string' },
            },
            required: ['signal_id'],
          },
        },
      },
      required: ['overall'],
      additionalProperties: false,
    },
  },
  {
    name: 'log_experience_note',
    description:
      "Capture something she said that is worth keeping but does not fit a structured field — a vent, a description of a hard afternoon, a thing that happened. Store her words verbatim in `body`. This is the 'dump' path: never impose structure on it, and never ask follow-up questions just to fill in metadata.",
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Her words, as close to verbatim as possible.' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_cycle_event',
    description:
      'Log a cycle event she has mentioned. Only for users who track their cycle. Never infer a period start from mood or symptoms — only from her saying so.',
    confirmation: 'none',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['period_start', 'period_end', 'spotting', 'ovulation_signs', 'hrt_change', 'note'],
        },
        local_date: { type: 'string', description: 'ISO date, YYYY-MM-DD.' },
        note: { type: 'string' },
      },
      required: ['kind', 'local_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'offer_challenge',
    description:
      "Put one small, concrete thing on the table. Pick from the library by `template_id` when something fits, or write your own for this moment. Match it to her actual capacity right now, not to what would be good for her: if she is depleted, only offer something marked low-capacity-safe. Offer ONE. Never a list, never a plan for the week. `offered_because` is shown to her if she asks why, so it must be honest.",
    confirmation: 'none',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Preferred. From the challenge library.' },
        title: { type: 'string', description: 'Only when writing a one-off.' },
        invitation: {
          type: 'string',
          description:
            'One sentence, an invitation not an instruction. No "you should", no "just".',
        },
        detail: { type: 'string' },
        offered_because: {
          type: 'string',
          description: 'Your real reason, in one sentence. She can see this.',
        },
      },
      required: ['offered_because'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_challenge',
    description:
      "Record what happened with something you offered. 'part_done' is a real outcome and should be used freely — treat it as a success, not a shortfall. 'skipped' needs no explanation and must never be followed by a nudge. 'declined' means never offer that one again.",
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string' },
        state: {
          type: 'string',
          enum: ['accepted', 'done', 'part_done', 'skipped', 'declined'],
        },
        reflection: { type: 'string', description: 'Her words on how it went, if she offered any.' },
        helped: { type: 'boolean' },
      },
      required: ['instance_id', 'state'],
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description:
      "Save something about her so you do not ask again. Use `provenance: 'stated'` ONLY when she said it — your own conclusions are 'inferred' and will be shown to her as something to confirm. A boundary ('do not mention my mother') is filed as kind 'boundary' and is then honoured absolutely. Do not remember transient things: today's mood belongs in a check-in, not in memory.",
    confirmation: 'none',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['fact', 'preference', 'boundary', 'pattern', 'goal', 'support', 'person'],
        },
        key: {
          type: 'string',
          description: "Stable dotted handle, e.g. 'work.shift_pattern'. Reuse to update.",
        },
        value: {
          type: 'string',
          description: 'The claim, phrased as you would say it back to her.',
        },
        provenance: { type: 'string', enum: ['stated', 'inferred', 'observed'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['kind', 'key', 'value', 'provenance'],
      additionalProperties: false,
    },
  },
  {
    name: 'forget',
    description:
      'Remove something you remembered, because she asked or because it turned out to be wrong. Removal is real — the memory is retired, not softened into "used to be true".',
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'review_history',
    description:
      "Look at what has actually been logged over a period, before saying anything about patterns. Use this rather than guessing from the conversation. If it returns little or nothing, say so plainly — 'there isn't much logged yet' is a fine answer and far better than an invented trend.",
    confirmation: 'none',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO date.' },
        to: { type: 'string', description: 'ISO date.' },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['check_ins', 'signals', 'notes', 'cycle', 'challenges'],
          },
        },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_appearance',
    description:
      "Offer to change how you look or what you are called. Only when SHE has raised it -- she said you feel wrong to her, she asked what you look like, she called you something else, or she is setting you up for the first time. Never as a reward, never to lighten a hard moment, and never on your own initiative in the middle of something difficult: interrupting someone to discuss your own appearance is about you, not her. Offer one change at a time, and say plainly that she can change it again whenever she likes.",
    confirmation: 'required',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        form: {
          type: 'string',
          enum: ['aura', 'bloom', 'friend'],
          description:
            'aura: a sphere of light. bloom: petals of light. friend: the small rounded figure from the logo. None of them has a face.',
        },
        palette: {
          type: 'string',
          enum: ['sunset', 'meadow', 'berry', 'citrus', 'calm', 'single'],
          description: 'Her colours. They carry no meaning; this is decoration she chooses.',
        },
        name: {
          type: 'string',
          description: "What she wants to call you. Empty string means back to MAGI.",
        },
        because: {
          type: 'string',
          description:
            'One short sentence, in her words not yours, on why this is being offered. Shown to her.',
        },
      },
      required: ['because'],
      additionalProperties: false,
    },
  },
  {
    name: 'show_progress',
    description:
      "Draw her what a stretch of time actually looked like: every day in the window, which ones she rated and how, and which ones have nothing. Use it when she asks how she has been doing, or when she is trying to decide whether something is getting better or worse and deserves to see the record rather than your impression of it. It draws only what is logged. Do NOT pair it with praise, encouragement or a verdict -- no 'good progress', no 'you're doing better'. If the window is mostly empty, say that plainly; an empty month is information, not a failure.",
    confirmation: 'none',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: "ISO date of the last day to include. Use her local date, not UTC.",
        },
        days: {
          type: 'integer',
          enum: [7, 30, 90],
          description: 'How many days back from `to`, inclusive.',
        },
      },
      required: ['to', 'days'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_insight',
    description:
      "Offer something you have noticed, for her to accept or reject. Phrase it tentatively — 'you may notice', 'this might be' — because it is a prompt for reflection, not a finding. NEVER propose anything that reads as a diagnosis, a cause, or a prediction about her health. Always call review_history first; an insight with no data behind it is a guess wearing a lab coat.",
    confirmation: 'required',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        observation: { type: 'string' },
        based_on: {
          type: 'object',
          description:
            'The actual evidence: which dates, which signals, how many entries. She can open this.',
        },
        period_start: { type: 'string' },
        period_end: { type: 'string' },
        category: { type: 'string' },
      },
      required: ['observation', 'based_on'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_healthcare_summary',
    description:
      "Draft something she can hand to a GP, employer or school. This is the feature the product exists for, so take care: use only what is actually logged, keep her own language for how things feel, and do not translate her experience into clinical terms she did not use. The draft is hers to edit before it goes anywhere.",
    confirmation: 'required',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        purpose: {
          type: 'string',
          enum: ['gp_appointment', 'referral', 'workplace', 'education', 'self', 'other'],
        },
        period_start: { type: 'string' },
        period_end: { type: 'string' },
        format: { type: 'string', enum: ['bullets', 'timeline', 'letter', 'symptom_table'] },
        detail_level: { type: 'string', enum: ['brief', 'standard', 'full'] },
        tone: { type: 'string', enum: ['plain', 'clinical', 'personal'] },
        audience_note: { type: 'string' },
      },
      required: ['purpose', 'period_start', 'period_end'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_profile',
    description:
      'Change what the app knows about her — neurotypes, how she wants you to talk to her, topics you must not raise. Always a proposal she confirms, because getting this wrong silently would be worse than asking.',
    confirmation: 'required',
    suppressedInCrisis: true,
    input_schema: {
      type: 'object',
      properties: {
        preferred_name: { type: 'string' },
        pronouns: { type: 'string' },
        neurotypes: { type: 'array', items: { type: 'string' } },
        hormone_context: { type: 'array', items: { type: 'string' } },
        support_style: { type: 'string', enum: ['brief', 'warm', 'practical', 'curious'] },
        off_limits_topics: { type: 'array', items: { type: 'string' } },
        avoid_words: { type: 'array', items: { type: 'string' } },
        tracks_cycle: { type: 'boolean' },
        sensory_notes: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'show_support_resources',
    description:
      "Bring up crisis and support options. The safety layer already does this automatically when it needs to — call this only when she asks for help finding support, or asks what is available. Calling it does not require her to be in crisis and must never be framed as if it does.",
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'open_safety_plan',
    description:
      "Bring up her own safety plan — the one she wrote in a calmer moment. In distress, reading her own words back is worth more than anything you can compose. If she has not written one, do not raise it while she is struggling; offer it later.",
    confirmation: 'none',
    suppressedInCrisis: false,
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['read', 'edit'] },
      },
      additionalProperties: false,
    },
  },
];

export const TOOLS_BY_NAME: Record<string, ToolDefinition> = Object.fromEntries(
  MAGI_TOOLS.map((t) => [t.name, t]),
);

/**
 * The tool list handed to the model for a given turn.
 *
 * When risk is elevated or above, everything non-essential is withheld — not merely
 * discouraged in the prompt. A model cannot offer a hydration challenge to someone
 * describing self-harm if the tool is not in its list.
 */
export function toolsForTurn(opts: {
  suppressNonEssential: boolean;
  tracksCycle: boolean;
}): ToolDefinition[] {
  return MAGI_TOOLS.filter((t) => {
    if (opts.suppressNonEssential && t.suppressedInCrisis) return false;
    if (t.name === 'record_cycle_event' && !opts.tracksCycle) return false;
    return true;
  });
}

/**
 * Provider-neutral tool shape. Each provider's client translates from here, so the tool
 * definitions above never mention a vendor.
 */
export function toLlmTools(tools: ToolDefinition[]): LlmTool[] {
  return tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    parameters: input_schema as unknown as Record<string, unknown>,
  }));
}
