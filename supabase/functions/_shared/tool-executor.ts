/**
 * Executes MAGI's tool calls.
 *
 * Two return paths:
 *   · confirmation 'none'     — the write happens now; the card reports it.
 *   · confirmation 'required' — nothing is written; a proposal card comes back and the
 *                              write waits for the user's tap on the next request.
 *
 * Every write goes through the caller's own Supabase client, so RLS is the boundary. A bug
 * in this file can corrupt the user's own data; it cannot reach anyone else's.
 *
 * `resultForModel` is what the model sees. It is written as terse fact, never as
 * encouragement, so MAGI does not start congratulating the user on having been logged.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { TOOLS_BY_NAME } from './tools.ts';
import { resourcesForAge } from './crisis-resources.ts';
import { buildSummaryPrompt, renderSourceData, type SummarySourceData } from './summary.ts';
import type { LlmClient } from './llm.ts';
import type { MagiCard, MagiContext } from './types.ts';

export interface ExecuteDeps {
  db: SupabaseClient;
  ctx: MagiContext;
  /** Whichever provider is configured. The executor never knows which. */
  llm: LlmClient;
}

export interface ExecuteResult {
  card: MagiCard | null;
  resultForModel: string;
  isError?: boolean;
}

let cardSeq = 0;
function cardId(kind: string): string {
  cardSeq += 1;
  return `${kind}_${Date.now().toString(36)}_${cardSeq}`;
}

export async function executeTool(
  name: string,
  rawInput: Record<string, unknown>,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const def = TOOLS_BY_NAME[name];
  if (!def) {
    return { card: null, resultForModel: `Unknown tool "${name}".`, isError: true };
  }

  try {
    if (def.confirmation === 'required') {
      return await propose(name, rawInput, deps);
    }
    return await perform(name, rawInput, deps);
  } catch (err) {
    // Tool failure must never become a wall of technical text in a supportive conversation.
    console.error(`[magi] tool ${name} failed`, err);
    return {
      card: null,
      resultForModel: `That did not save. Do not mention the failure in technical terms; if it matters, say plainly that it did not save and offer to try again.`,
      isError: true,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Proposals
 * ------------------------------------------------------------------ */

async function propose(
  name: string,
  input: Record<string, unknown>,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const id = cardId('proposal');

  if (name === 'draft_healthcare_summary') {
    // Composed here, before the user sees it, so the proposal card contains the real draft.
    const { draft, sources, meta } = await composeSummary(input, deps);
    return {
      card: {
        id,
        kind: 'summary_proposal',
        proposal: {
          proposal_id: id,
          tool: name,
          input: { ...input, ...meta, draft_body: draft, sources },
          accept_label: 'Save this',
          reject_label: 'Not this',
        },
        data: { draft, ...meta, sources },
        accessibleSummary: `A draft summary for ${String(meta.purpose).replace(/_/g, ' ')}, covering ${meta.period_start} to ${meta.period_end}. You can edit it before saving.`,
      },
      resultForModel:
        'A draft summary has been prepared and shown to her to read, edit and save. Do not repeat the draft in your reply. Say in one sentence what it covers and that she can change anything in it.',
    };
  }

  if (name === 'propose_insight') {
    const observation = String(input.observation ?? '');
    return {
      card: {
        id,
        kind: 'insight_proposal',
        proposal: {
          proposal_id: id,
          tool: name,
          input,
          accept_label: 'That fits',
          reject_label: "That's not it",
        },
        data: {
          observation,
          based_on: input.based_on ?? {},
          period_start: input.period_start ?? null,
          period_end: input.period_end ?? null,
        },
        accessibleSummary: `Something MAGI noticed: ${observation}. You can accept it or say it does not fit.`,
      },
      resultForModel:
        'The observation has been put to her to accept or reject. Do not restate it in your reply and do not defend it.',
    };
  }

  if (name === 'propose_appearance') {
    const patch: Record<string, unknown> = {};
    for (const key of ['form', 'palette', 'name'] as const) {
      if (typeof input[key] === 'string') patch[key] = input[key];
    }
    const described = Object.entries(patch)
      .map(([k, v]) => (k === 'name' ? `call her ${v || 'MAGI'}` : `${k}: ${v}`))
      .join(', ');
    return {
      card: {
        id,
        kind: 'appearance_proposal',
        proposal: {
          proposal_id: id,
          tool: name,
          input: patch,
          accept_label: 'Yes, do that',
          reject_label: 'Leave it',
        },
        data: { appearance: patch, because: String(input.because ?? '') },
        accessibleSummary: `MAGI is offering to change how she looks: ${described}. You can accept or leave it as it is, and change it yourself any time in settings.`,
      },
      resultForModel:
        'The change has been offered, with a preview she can see. Nothing has been changed yet. Do not describe the preview in words and do not ask again.',
    };
  }

  if (name === 'update_profile') {
    const changes = Object.entries(input).filter(([, v]) => v !== undefined && v !== null);
    return {
      card: {
        id,
        kind: 'profile_proposal',
        proposal: {
          proposal_id: id,
          tool: name,
          input,
          accept_label: 'Yes, that’s right',
          reject_label: 'No, change it',
        },
        data: { changes: Object.fromEntries(changes) },
        accessibleSummary: `MAGI wants to update what she knows about you: ${changes.map(([k]) => k.replace(/_/g, ' ')).join(', ')}. You can confirm or correct it.`,
      },
      resultForModel:
        'The change has been put to her to confirm. Nothing has been saved yet. Ask nothing further about it.',
    };
  }

  return { card: null, resultForModel: `No proposal handler for "${name}".`, isError: true };
}

/**
 * Applies a proposal the user has accepted. Called from the handler, not from the model.
 * The tool name is checked against the confirmation-gated set before anything is written.
 */
export async function applyProposal(
  name: string,
  input: Record<string, unknown>,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const def = TOOLS_BY_NAME[name];
  if (!def || def.confirmation !== 'required') {
    return {
      card: null,
      resultForModel: `"${name}" is not a confirmable proposal.`,
      isError: true,
    };
  }
  const { db, ctx } = deps;

  if (name === 'propose_appearance') {
    /*
      Merged into whatever is already stored rather than replacing it, so accepting a change
      of colour does not silently reset the name she chose three weeks ago. The column's
      CHECK constraint is what actually enforces the allowed values -- this is a write the
      user authorised, but the shape is still the database's business, not the model's.
    */
    const { data: existing } = await db
      .from('profile')
      .select('magi_appearance')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const merged = {
      ...((existing?.magi_appearance as Record<string, unknown>) ?? {}),
      ...Object.fromEntries(
        (['form', 'palette', 'name'] as const)
          .filter((k) => typeof input[k] === 'string')
          .map((k) => [k, input[k]]),
      ),
    };

    const { error } = await db
      .from('profile')
      .update({ magi_appearance: merged })
      .eq('account_id', ctx.accountId);
    if (error) throw error;

    return {
      card: {
        id: cardId('appearance'),
        kind: 'appearance_proposal',
        data: { appearance: merged, applied: true },
        accessibleSummary: 'Done. You can change how she looks any time in settings.',
      },
      resultForModel:
        'She accepted. The change is saved and the app has already applied it, so do not ' +
        'describe what you now look like -- she can see it. One short line is plenty.',
    };
  }

  if (name === 'propose_insight') {
    const { data, error } = await db
      .from('insight')
      .insert({
        account_id: ctx.accountId,
        observation: String(input.observation ?? ''),
        based_on: input.based_on ?? {},
        period_start: input.period_start ?? null,
        period_end: input.period_end ?? null,
        category: input.category ?? null,
        state: 'accepted',
        surfaced_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    return {
      card: {
        id: cardId('insight'),
        kind: 'insight_proposal',
        data: { id: data.id, observation: input.observation, accepted: true },
        accessibleSummary: 'Saved. You can find this with your other patterns.',
      },
      resultForModel: 'She accepted the observation. It is saved. Do not labour the point.',
    };
  }

  if (name === 'draft_healthcare_summary') {
    const draft = String(input.draft_body ?? '');
    const { data, error } = await db
      .from('healthcare_summary')
      .insert({
        account_id: ctx.accountId,
        purpose: String(input.purpose ?? 'other'),
        audience_note: input.audience_note ?? null,
        period_start: String(input.period_start),
        period_end: String(input.period_end),
        format: String(input.format ?? 'bullets'),
        detail_level: String(input.detail_level ?? 'standard'),
        tone: String(input.tone ?? 'plain'),
        draft_body: draft,
        body: String(input.body ?? draft),
        sources: input.sources ?? {},
      })
      .select('id')
      .single();
    if (error) throw error;
    return {
      card: {
        id: cardId('summary'),
        kind: 'summary_proposal',
        data: { id: data.id, saved: true },
        accessibleSummary: 'Summary saved. You can open, edit or export it whenever you need it.',
      },
      resultForModel:
        'The summary is saved and she can export it. One short sentence acknowledging that is enough.',
    };
  }

  if (name === 'update_profile') {
    const allowed = [
      'preferred_name',
      'pronouns',
      'neurotypes',
      'hormone_context',
      'support_style',
      'off_limits_topics',
      'avoid_words',
      'tracks_cycle',
      'sensory_notes',
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (input[key] !== undefined && input[key] !== null) patch[key] = input[key];
    }
    if (!Object.keys(patch).length) {
      return { card: null, resultForModel: 'Nothing to change.', isError: true };
    }
    const { error } = await db.from('profile').update(patch).eq('account_id', ctx.accountId);
    if (error) throw error;
    return {
      card: {
        id: cardId('profile'),
        kind: 'profile_proposal',
        data: { saved: true, changes: patch },
        accessibleSummary: 'Updated.',
      },
      resultForModel: 'Confirmed and saved. Carry on with what she was saying.',
    };
  }

  return { card: null, resultForModel: `No apply handler for "${name}".`, isError: true };
}

/* ------------------------------------------------------------------ *
 * Immediate tools
 * ------------------------------------------------------------------ */

async function perform(
  name: string,
  input: Record<string, unknown>,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const { db, ctx } = deps;

  switch (name) {
    case 'log_check_in': {
      const overall = String(input.overall);
      const note = input.note ? String(input.note) : null;

      const { data: row, error } = await db
        .from('check_in')
        .upsert(
          {
            account_id: ctx.accountId,
            local_date: ctx.localDate,
            overall,
            note,
            captured_by_magi: true,
            source: 'magi_prompted',
          },
          { onConflict: 'account_id,local_date' },
        )
        .select('id')
        .single();
      if (error) throw error;

      const signals = Array.isArray(input.signals) ? input.signals : [];
      const readings = signals
        .map((s) => {
          const sig = s as Record<string, unknown>;
          const signalId = String(sig.signal_id ?? '');
          if (!signalId) return null;
          const base = {
            account_id: ctx.accountId,
            signal_id: signalId,
            check_in_id: row.id,
            local_date: ctx.localDate,
            captured_by_magi: true,
          };
          if (typeof sig.value_numeric === 'number') return { ...base, value_numeric: sig.value_numeric };
          if (typeof sig.value_boolean === 'boolean') return { ...base, value_boolean: sig.value_boolean };
          if (typeof sig.value_text === 'string') return { ...base, value_text: sig.value_text };
          return null;
        })
        .filter(Boolean);

      let savedSignals = 0;
      if (readings.length) {
        const { error: sigErr } = await db.from('signal_reading').insert(readings as object[]);
        // A rejected signal must not lose the check-in that succeeded.
        if (sigErr) console.error('[magi] signal_reading insert failed', sigErr);
        else savedSignals = readings.length;
      }

      return {
        card: {
          id: cardId('check_in'),
          kind: 'check_in_logged',
          data: { overall, note, signal_count: savedSignals, local_date: ctx.localDate },
          accessibleSummary: `Today logged as ${overall}${note ? `, with your note` : ''}. You can change it any time.`,
        },
        resultForModel: `Logged: ${overall}${savedSignals ? `, plus ${savedSignals} signal reading(s)` : ''}. Do not thank her for checking in or mention the record.`,
      };
    }

    case 'log_experience_note': {
      const body = String(input.body ?? '').trim();
      if (!body) return { card: null, resultForModel: 'Nothing to save.', isError: true };
      const tags = Array.isArray(input.tags) ? (input.tags as string[]) : [];

      const { error } = await db.from('experience_note').insert({
        account_id: ctx.accountId,
        body,
        tags,
        local_date: ctx.localDate,
      });
      if (error) throw error;

      return {
        card: {
          id: cardId('note'),
          kind: 'note_saved',
          data: { excerpt: body.slice(0, 180), tags, local_date: ctx.localDate },
          accessibleSummary: 'Note saved in your own words.',
        },
        resultForModel: 'Kept. Do not read it back to her.',
      };
    }

    case 'record_cycle_event': {
      const { error } = await db.from('cycle_event').insert({
        account_id: ctx.accountId,
        kind: String(input.kind),
        local_date: String(input.local_date),
        note: input.note ?? null,
      });
      if (error) throw error;
      return {
        card: {
          id: cardId('cycle'),
          kind: 'cycle_logged',
          data: { kind: input.kind, local_date: input.local_date },
          accessibleSummary: `Cycle event logged for ${input.local_date}.`,
        },
        resultForModel: 'Logged.',
      };
    }

    case 'offer_challenge': {
      let title = input.title ? String(input.title) : null;
      let invitation = input.invitation ? String(input.invitation) : null;
      let detail = input.detail ? String(input.detail) : null;
      const templateId = input.template_id ? String(input.template_id) : null;

      if (templateId) {
        const { data: tpl } = await db
          .from('challenge_template')
          .select('title, invitation, detail, min_age')
          .eq('id', templateId)
          .maybeSingle();
        if (tpl) {
          if (ctx.age != null && ctx.age < tpl.min_age) {
            return {
              card: null,
              resultForModel: `That one is not suitable for her age. Offer something else, or nothing.`,
              isError: true,
            };
          }
          title = tpl.title;
          invitation = tpl.invitation;
          detail = tpl.detail;
        }
      }

      if (!title || !invitation) {
        return {
          card: null,
          resultForModel: 'A challenge needs a title and an invitation, or a valid template id.',
          isError: true,
        };
      }

      const { data, error } = await db
        .from('challenge_instance')
        .insert({
          account_id: ctx.accountId,
          template_id: templateId,
          title,
          invitation,
          detail,
          offered_because: input.offered_because ? String(input.offered_because) : null,
        })
        .select('id')
        .single();
      if (error) throw error;

      return {
        card: {
          id: cardId('challenge'),
          kind: 'challenge',
          data: {
            instance_id: data.id,
            title,
            invitation,
            detail,
            offered_because: input.offered_because ?? null,
          },
          accessibleSummary: `${title}. ${invitation} You can take it, leave it, or come back to it.`,
        },
        resultForModel: `Offered "${title}". It is shown beside your message, so do not repeat the wording. One short line at most, and make clear she can ignore it.`,
      };
    }

    case 'update_challenge': {
      const state = String(input.state);
      const patch: Record<string, unknown> = {
        state,
        responded_at: new Date().toISOString(),
      };
      if (state === 'done' || state === 'part_done') patch.completed_at = new Date().toISOString();
      if (state === 'declined') patch.never_offer_again = true;
      if (input.reflection) patch.reflection = String(input.reflection);
      if (typeof input.helped === 'boolean') patch.helped = input.helped;

      const { error } = await db
        .from('challenge_instance')
        .update(patch)
        .eq('id', String(input.instance_id))
        .eq('account_id', ctx.accountId);
      if (error) throw error;

      return {
        card: {
          id: cardId('challenge_updated'),
          kind: 'challenge_updated',
          data: { instance_id: input.instance_id, state },
          accessibleSummary: `Marked as ${state.replace('_', ' ')}.`,
        },
        resultForModel:
          state === 'skipped' || state === 'declined'
            ? 'Noted. Say nothing about it — no reassurance, no "that\'s okay", which would imply it needed excusing.'
            : `Noted as ${state}. If she did part of it, treat that as having done it.`,
      };
    }

    case 'remember': {
      const kind = String(input.kind);
      const key = String(input.key);
      const value = String(input.value);
      const provenance = String(input.provenance ?? 'inferred') as
        | 'stated'
        | 'inferred'
        | 'observed';
      const confidence =
        typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : 0.5;

      const { data, error } = await db
        .from('magi_memory')
        .upsert(
          {
            account_id: ctx.accountId,
            kind,
            key,
            value,
            provenance,
            confidence,
            // Only her own words are treated as settled.
            state: provenance === 'stated' ? 'active' : 'needs_confirming',
            confirmed_at: provenance === 'stated' ? new Date().toISOString() : null,
            last_referenced_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,kind,key' },
        )
        .select('id')
        .single();
      if (error) throw error;

      await db.from('magi_memory_event').insert({
        memory_id: data.id,
        account_id: ctx.accountId,
        action: 'created',
        actor: 'magi',
        after_value: value,
      });

      return {
        card: {
          id: cardId('memory'),
          kind: 'memory_saved',
          data: { id: data.id, kind, value, provenance },
          accessibleSummary:
            provenance === 'stated'
              ? `MAGI has noted: ${value}`
              : `MAGI thinks: ${value}. You can correct this.`,
        },
        resultForModel:
          provenance === 'stated'
            ? 'Noted. Never say that you have noted it.'
            : 'Noted as unconfirmed. Do not assert it back to her as fact.',
      };
    }

    case 'forget': {
      const key = String(input.key);
      const { data, error } = await db
        .from('magi_memory')
        .update({ state: 'retired', retired_at: new Date().toISOString() })
        .eq('account_id', ctx.accountId)
        .eq('key', key)
        .select('id, value');
      if (error) throw error;

      if (data?.length) {
        await db.from('magi_memory_event').insert(
          data.map((m) => ({
            memory_id: m.id,
            account_id: ctx.accountId,
            action: 'retired',
            actor: 'user',
            before_value: m.value,
          })),
        );
      }

      return {
        card: {
          id: cardId('memory_removed'),
          kind: 'memory_removed',
          data: { key, removed: data?.length ?? 0 },
          accessibleSummary: 'Removed. MAGI will not bring that up again.',
        },
        resultForModel:
          'Gone. Confirm in a few words. Do not say "I used to think" or otherwise keep it half-alive.',
      };
    }

    case 'show_progress': {
      const to = String(input.to);
      const days = Math.min(180, Math.max(7, Number(input.days ?? 30)));
      const DAY_MS = 86_400_000;
      const toDate = new Date(`${to}T00:00:00Z`);
      if (Number.isNaN(toDate.getTime())) {
        return {
          card: null,
          resultForModel: `"${to}" is not a date. Pass her local date as YYYY-MM-DD.`,
          isError: true,
        };
      }
      const fromDate = new Date(toDate.getTime() - (days - 1) * DAY_MS);
      const from = fromDate.toISOString().slice(0, 10);

      const data = await gatherHistory(db, ctx, from, to, ['check_ins', 'notes']);
      const rated = new Map(data.checkIns.map((c) => [c.local_date, c.overall]));

      /*
        Every calendar day in the window, including the ones with nothing in them.
        This is the whole point of the card: a strip of only the days she happened to log
        would compress a fortnight of silence into a tidy row and imply a consistency that
        was not there. The gaps are data.
      */
      const grid: { date: string; overall: string | null }[] = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(fromDate.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        grid.push({ date, overall: rated.get(date) ?? null });
      }

      const counts: Record<string, number> = { rough: 0, low: 0, ok: 0, good: 0, bright: 0 };
      for (const day of grid) {
        if (day.overall && day.overall in counts) counts[day.overall] += 1;
      }
      const logged = grid.filter((d) => d.overall).length;

      const breakdown = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');

      return {
        card: {
          id: cardId('progress'),
          kind: 'progress',
          data: { from, to, days: grid, counts, logged, total: days, notes: data.notes.length },
          accessibleSummary:
            logged === 0
              ? `Nothing logged in the ${days} days up to ${to}.`
              : `${logged} of ${days} days logged between ${from} and ${to}: ${breakdown}.` +
                ` ${days - logged} days with nothing.`,
        },
        resultForModel:
          logged === 0
            ? `Nothing is logged in the ${days} days up to ${to}. The card shows an empty stretch. Say so plainly and do not describe any pattern or offer any encouragement about it.`
            : `Drawn for her: ${logged} of ${days} days logged between ${from} and ${to}. ` +
              `Ratings: ${breakdown}. ${days - logged} days unlogged. ${data.notes.length} notes.\n` +
              `She can see all of this. Do not read it back to her number by number, and do ` +
              `not give it a verdict -- no praise, no "progress", no conclusion about whether ` +
              `things are improving. One honest observation or a question is enough.`,
      };
    }

    case 'review_history': {
      const from = String(input.from);
      const to = String(input.to);
      const include = Array.isArray(input.include)
        ? (input.include as string[])
        : ['check_ins', 'signals', 'notes'];

      const data = await gatherHistory(db, ctx, from, to, include);

      const total =
        data.checkIns.length +
        data.notes.length +
        data.signals.reduce((n, s) => n + s.readings.length, 0);

      return {
        card: {
          id: cardId('history'),
          kind: 'history',
          data: { from, to, ...data },
          accessibleSummary: `${total} entries logged between ${from} and ${to}.`,
        },
        resultForModel:
          total === 0
            ? `Nothing is logged between ${from} and ${to}. Say that plainly. Do not describe any pattern.`
            : `${total} entries between ${from} and ${to}:\n${renderSourceData(data)}\n\nUse only what is here. If it is thin, say so.`,
      };
    }

    case 'show_support_resources': {
      const resources = resourcesForAge(ctx.age, false);
      return {
        card: {
          id: cardId('support'),
          kind: 'support_resources',
          data: { resources, reason: input.reason ?? null },
          accessibleSummary: `${resources.length} support options, with phone numbers and text lines.`,
        },
        resultForModel:
          'The options are shown beside your message. Name one or two rather than listing them, and do not sound like you are handing her off.',
      };
    }

    case 'open_safety_plan': {
      const hasPlan = Boolean(
        ctx.safetyPlan &&
          (ctx.safetyPlan.what_helps ||
            ctx.safetyPlan.warning_signs ||
            ctx.safetyPlan.message_to_self),
      );
      return {
        card: {
          id: cardId('safety_plan'),
          kind: 'safety_plan',
          data: { mode: input.mode ?? 'read', exists: hasPlan, plan: ctx.safetyPlan },
          accessibleSummary: hasPlan
            ? 'Your safety plan, in your own words.'
            : 'You have not written a safety plan yet.',
        },
        resultForModel: hasPlan
          ? 'Her plan is open beside your message. Point to her own words in it rather than adding your own.'
          : 'She has not written one. Do not raise writing one while she is struggling.',
      };
    }

    default:
      return { card: null, resultForModel: `No handler for "${name}".`, isError: true };
  }
}

/* ------------------------------------------------------------------ *
 * Shared data gathering
 * ------------------------------------------------------------------ */

async function gatherHistory(
  db: SupabaseClient,
  ctx: MagiContext,
  from: string,
  to: string,
  include: string[],
): Promise<SummarySourceData> {
  const wants = (k: string) => include.includes(k);

  const [checkIns, readings, notes, cycle, challenges, defs] = await Promise.all([
    wants('check_ins')
      ? db
          .from('check_in')
          .select('local_date, overall, note')
          .eq('account_id', ctx.accountId)
          .gte('local_date', from)
          .lte('local_date', to)
          .order('local_date')
      : Promise.resolve({ data: [] }),
    wants('signals')
      ? db
          .from('signal_reading')
          .select('signal_id, local_date, value_numeric, value_boolean, value_text')
          .eq('account_id', ctx.accountId)
          .gte('local_date', from)
          .lte('local_date', to)
          .order('local_date')
      : Promise.resolve({ data: [] }),
    wants('notes')
      ? db
          .from('experience_note')
          .select('local_date, body')
          .eq('account_id', ctx.accountId)
          .gte('local_date', from)
          .lte('local_date', to)
          .order('local_date')
      : Promise.resolve({ data: [] }),
    wants('cycle')
      ? db
          .from('cycle_event')
          .select('local_date, kind')
          .eq('account_id', ctx.accountId)
          .gte('local_date', from)
          .lte('local_date', to)
          .order('local_date')
      : Promise.resolve({ data: [] }),
    wants('challenges')
      ? db
          .from('challenge_instance')
          .select('title, state, helped, reflection')
          .eq('account_id', ctx.accountId)
          .gte('offered_at', `${from}T00:00:00Z`)
          .lte('offered_at', `${to}T23:59:59Z`)
      : Promise.resolve({ data: [] }),
    db.from('signal_definition').select('id, label, unit'),
  ]);

  const labels = new Map(
    ((defs.data ?? []) as { id: string; label: string; unit: string | null }[]).map((d) => [
      d.id,
      d,
    ]),
  );

  const grouped = new Map<string, { local_date: string; value: string }[]>();
  for (const r of (readings.data ?? []) as Record<string, unknown>[]) {
    const id = String(r.signal_id);
    const value =
      r.value_numeric != null
        ? String(r.value_numeric)
        : r.value_boolean != null
          ? r.value_boolean
            ? 'yes'
            : 'no'
          : String(r.value_text ?? '');
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push({ local_date: String(r.local_date), value });
  }

  return {
    checkIns: (checkIns.data ?? []) as SummarySourceData['checkIns'],
    signals: [...grouped.entries()].map(([id, rs]) => ({
      signal_id: id,
      label: labels.get(id)?.label ?? id,
      unit: labels.get(id)?.unit ?? null,
      readings: rs,
    })),
    notes: (notes.data ?? []) as SummarySourceData['notes'],
    cycleEvents: (cycle.data ?? []) as SummarySourceData['cycleEvents'],
    challenges: (challenges.data ?? []) as SummarySourceData['challenges'],
  };
}

async function composeSummary(
  input: Record<string, unknown>,
  deps: ExecuteDeps,
): Promise<{ draft: string; sources: Record<string, unknown>; meta: Record<string, unknown> }> {
  const { db, ctx, llm } = deps;

  const meta = {
    purpose: String(input.purpose ?? 'other'),
    period_start: String(input.period_start),
    period_end: String(input.period_end),
    format: String(input.format ?? 'bullets'),
    detail_level: String(input.detail_level ?? 'standard'),
    tone: String(input.tone ?? 'plain'),
    audience_note: input.audience_note ? String(input.audience_note) : null,
  };

  const source = await gatherHistory(db, ctx, meta.period_start, meta.period_end, [
    'check_ins',
    'signals',
    'notes',
    'cycle',
    'challenges',
  ]);

  const system = buildSummaryPrompt({
    ctx,
    purpose: meta.purpose,
    format: meta.format,
    detailLevel: meta.detail_level,
    tone: meta.tone,
    audienceNote: meta.audience_note ?? undefined,
    periodStart: meta.period_start,
    periodEnd: meta.period_end,
  });

  const res = await llm.complete({
    system,
    // Lower temperature than conversation: this is a document of record, not a chat. Some
    // models reject a custom temperature, in which case the client drops it and retries.
    temperature: 0.3,
    maxTokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Source data for ${meta.period_start} to ${meta.period_end}:\n\n${renderSourceData(source)}`,
      },
    ],
  });

  return {
    draft: res.text,
    sources: {
      check_in_count: source.checkIns.length,
      note_count: source.notes.length,
      signal_count: source.signals.reduce((n, s) => n + s.readings.length, 0),
      signals_tracked: source.signals.map((s) => s.label),
      period: [meta.period_start, meta.period_end],
    },
    meta,
  };
}
