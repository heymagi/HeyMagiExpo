/**
 * Healthcare summary drafting.
 *
 * This is the feature the beta exists to deliver, and the one with the most potential to do
 * harm if it is done glibly. A summary that translates "I couldn't get out of bed for three
 * days" into "reports reduced motivation" has taken the one thing the user could not say out
 * loud and made it sound minor. So the drafting prompt's central instruction is preservation,
 * not polish.
 *
 * The draft is produced in its own model call, separate from conversation, so that nothing
 * about the tone of the chat leaks into a document a GP will read.
 */

import type { MagiContext } from './types.ts';

export interface SummarySourceData {
  checkIns: { local_date: string; overall: string | null; note: string | null }[];
  signals: {
    signal_id: string;
    label: string;
    unit: string | null;
    readings: { local_date: string; value: string }[];
  }[];
  notes: { local_date: string; body: string }[];
  cycleEvents: { local_date: string; kind: string }[];
  challenges: { title: string; state: string; helped: boolean | null; reflection: string | null }[];
}

const PURPOSE_FRAMING: Record<string, string> = {
  gp_appointment:
    'This is for a GP appointment, usually ten minutes long. The doctor needs the pattern and the impact, fast. Put the thing she most needs heard first, because the appointment may end before the end of the page.',
  referral:
    'This supports a referral request. Emphasise duration, frequency and functional impact — those are what referral thresholds are actually assessed on.',
  workplace:
    'This is for an employer or occupational health. Describe impact on work and what helps. Include no diagnosis, no speculation, and nothing about her personal life that the employer has no business knowing.',
  education:
    'This is for a school, college or university. Focus on what makes learning harder and what adjustments help. Written to be read by someone with no clinical training.',
  self: 'This is for her own use, to see her own months laid out.',
  other: 'General purpose. Keep it plain and factual.',
};

const DETAIL_FRAMING: Record<string, string> = {
  brief: 'One page at most. Six bullets or fewer. Only the most significant things.',
  standard: 'Roughly one page. Group related things together.',
  full: 'Include everything logged that is relevant, with dates.',
};

const TONE_FRAMING: Record<string, string> = {
  plain:
    'Plain English. No clinical vocabulary unless she used it herself. This is the default and usually the right choice.',
  clinical:
    'Use recognised clinical terms only where she herself used them, or where a term is the accepted name for something she described plainly. Never introduce a diagnostic label she has not been given.',
  personal:
    'First person, in her voice. She is telling them what has been happening. Keep her own phrasing wherever it exists in the source material.',
};

const FORMAT_FRAMING: Record<string, string> = {
  bullets: 'Short bullet points under two or three headings.',
  timeline: 'Chronological, dated entries, oldest first.',
  letter: 'A short letter, addressed to the reader, signed off by her.',
  symptom_table:
    'A simple table: what happens, how often, how bad, what it stops her doing. Markdown table.',
};

export function buildSummaryPrompt(args: {
  ctx: MagiContext;
  purpose: string;
  format: string;
  detailLevel: string;
  tone: string;
  audienceNote?: string;
  periodStart: string;
  periodEnd: string;
}): string {
  const { ctx, purpose, format, detailLevel, tone, audienceNote, periodStart, periodEnd } = args;
  const p = ctx.profile;

  return `You are drafting a document that a woman will hand to someone who has power over her care, her job or her education. She has often not been believed before. Your job is to make what she has recorded legible to that reader without making it sound smaller than it is.

Absolute rules:

Use ONLY what appears in the source data below. If something is not logged, it does not go in the document. Do not round a gap up into a trend, do not describe three entries as "frequently", and do not fill a thin month with cautious generalisations.

Preserve her words. Where she has written how something feels, quote it or keep her phrasing. Never replace a vivid description with a flat clinical equivalent — "I couldn't get out of bed for three days" must not become "reduced motivation".

State no diagnosis and imply none. Do not name a condition unless she has told the app she has that condition, and then only as something she has reported.

No causal claims. "The worst days cluster in the week before her period" is supportable from dates. "Her symptoms are caused by hormonal fluctuation" is not.

Quantify honestly. Where you say how often something happened, the number must be countable in the data. Say how many days are covered and how many entries exist, so the reader can weigh it.

If there is too little logged to support a useful document, say so in one line at the top and produce what can honestly be produced. That is a far better outcome than a confident-looking page built on four entries.

Do not add advice, next steps, or requests for treatment. She decides what to ask for.

Do not add a covering note, a disclaimer, or a signature block unless the format calls for it. No "I hope this finds you well".

${PURPOSE_FRAMING[purpose] ?? PURPOSE_FRAMING.other}

Format: ${FORMAT_FRAMING[format] ?? FORMAT_FRAMING.bullets}
Detail: ${DETAIL_FRAMING[detailLevel] ?? DETAIL_FRAMING.standard}
Register: ${TONE_FRAMING[tone] ?? TONE_FRAMING.plain}
${audienceNote ? `She has said about the reader: "${audienceNote}"` : ''}

Period covered: ${periodStart} to ${periodEnd}.
${p.preferred_name ? `She goes by ${p.preferred_name}.` : ''}${p.pronouns ? ` Pronouns: ${p.pronouns}.` : ''}
${p.neurotypes.length ? `She describes herself as: ${p.neurotypes.join(', ')}. You may state this as self-described.` : ''}
${p.health_conditions.length ? `Conditions she has reported: ${p.health_conditions.join(', ')}. You may state these as reported by her.` : ''}
${ctx.age != null && ctx.age < 18 ? `She is ${ctx.age}. Write so that a parent or carer reading alongside a professional can follow it.` : ''}

Output the document only. No preamble, no explanation of what you have done.`;
}

/** Compact, model-readable rendering of the source data. Dates first: they carry the weight. */
export function renderSourceData(d: SummarySourceData): string {
  const out: string[] = [];

  out.push(`CHECK-INS (${d.checkIns.length} entries)`);
  if (!d.checkIns.length) out.push('  none logged');
  for (const c of d.checkIns) {
    out.push(`  ${c.local_date}  ${c.overall ?? '—'}${c.note ? `  note: "${c.note}"` : ''}`);
  }

  out.push('');
  out.push(`TRACKED SIGNALS (${d.signals.length} tracked)`);
  if (!d.signals.length) out.push('  none tracked');
  for (const s of d.signals) {
    out.push(`  ${s.label}${s.unit ? ` (${s.unit})` : ''} — ${s.readings.length} readings`);
    for (const r of s.readings) out.push(`    ${r.local_date}: ${r.value}`);
  }

  out.push('');
  out.push(`HER OWN NOTES (${d.notes.length})`);
  if (!d.notes.length) out.push('  none');
  for (const n of d.notes) out.push(`  ${n.local_date}: "${n.body}"`);

  if (d.cycleEvents.length) {
    out.push('');
    out.push('CYCLE EVENTS');
    for (const c of d.cycleEvents) out.push(`  ${c.local_date}: ${c.kind}`);
  }

  if (d.challenges.length) {
    out.push('');
    out.push('THINGS SHE TRIED');
    for (const c of d.challenges) {
      out.push(
        `  "${c.title}" — ${c.state}${c.helped === true ? ', helped' : c.helped === false ? ', did not help' : ''}${c.reflection ? `, she said: "${c.reflection}"` : ''}`,
      );
    }
  }

  return out.join('\n');
}
