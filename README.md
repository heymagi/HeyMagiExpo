# MAGI

A wellbeing companion for neurodivergent women and women navigating hormonal change,
burnout, anxiety and low mood. One screen, one conversation. MAGI is the interface —
tracking, challenges, patterns and healthcare summaries all happen through her, as cards
inside the conversation, because there is nowhere else for them to live.

Expo (iOS, Android, web) + Supabase + a language model behind a provider interface.

Currently running on **OpenAI** (`gpt-5.6-terra`), because that is the funded key. The
Anthropic path is kept live and switching back is one env var — `MAGI_LLM_PROVIDER=anthropic`
— which moves replies, risk assessment and summary drafting together. Embeddings are always
OpenAI regardless: Anthropic serves no embeddings endpoint and the `vector(1536)` column is
pinned to `text-embedding-3-small`.

---

## Running it

```bash
npm install
cp .env.example .env      # fill in the Supabase URL and anon key
npm run dev               # then press w for web, or scan the QR with Expo Go
```

**Looking at the main screen without a backend:** `/preview` renders it with sample
content — orb, conversation, cards, composer, settings, and both the ordinary and
in-distress states. `?scene=quiet` opens straight into distress. It talks to nothing, and
it redirects to the real screen in a production build.

**Before relying on the model:** `npm run smoke:llm` checks the model id, the token-limit
parameter name, tool calling, JSON mode and the embedding dimension in one command. Worth
running whenever the model changes — the parameter surface moves between generations.

## Verifying it

```bash
npm run verify            # typecheck + accessibility audit + theme contrast + safety tests
npm run test:schema       # applies every migration to a throwaway Postgres and asserts RLS
npm run check:functions   # deno check on the edge function
```

`npm run verify` is the gate. It currently passes with:

| check | what it proves |
| --- | --- |
| `typecheck` | app compiles under `strict` |
| `audit:a11y` | no unlabelled controls, no hard-coded colours, no literal font sizes, no sub-44px targets |
| `build:theme` | 212 colour pairs meet their WCAG target in all four modes |
| `test:safety` | 12 tests on the risk lexicon — recall on genuine risk, no false escalation on ordinary distress |
| `test:schema` | 20 assertions: cross-user isolation, append-only transcripts, guardian boundaries |

Schema tests need `postgresql-16` and `postgresql-16-pgvector`. Safety tests need `deno`.

---

## Layout

```
app/                        the one screen, plus the gates before it
  index.tsx                 MAGI. Orb, conversation, composer, floating settings
  welcome / sign-in / sign-up
  age-check.tsx             age assurance — consequences stated before the answer
  guardian.tsx              guardian consent, under-16s only
  setup.tsx                 three skippable questions

components/
  ui/                       Text, Button, Card, Chip, Sheet, Field — accessibility is the default
  magi/                     MagiOrb, Conversation, Composer, SupportPanel, SettingsSheet
  magi/cards/               one renderer per tool result

theme/
  tokens.generated.ts       GENERATED — do not edit. `npm run build:theme`
  theme.report.txt          the contrast proof
  typography / space / motion / contrast

supabase/
  migrations/               8 migrations. 20260901100007_magi_seed.sql is GENERATED
  functions/magi/           the orchestrator — one endpoint, one turn
  functions/_shared/        taxonomy, risk, prompt, tools, tool-executor, summary
                            llm/provider/openai/anthropic — the provider interface
  apply-all.sql             GENERATED — all 8 migrations as one paste-able script
  tests/                    schema assertions and the Postgres harness

magi/data/                  intents.json, challenges.json, trackable-signals.json
tools/                      the generators and the audits
scripts/embed-intents.mjs   fills scenario_intent.embedding
```

Generated files are marked in their own headers. Editing one by hand is silently undone the
next time its generator runs.

---

## How a turn works

1. **Lexicon risk pass** — synchronous, offline, free, cannot fail.
2. **In parallel** — load context, embed the message, run an isolated model risk assessment.
3. **Take the higher of the two risk tiers.** The lexicon can raise a tier; nothing lowers one.
4. **Retrieve** nearest scenario intents to steer tone and approach. Risk overrides this.
5. **Compose** with a tool list filtered by tier — in crisis, the non-essential tools are
   removed from the model's list, not merely discouraged in the prompt.
6. **Persist** the transcript, the retrieval trace, and the risk event.

Two model calls per turn. The risk assessor never sees MAGI's persona, so a message crafted
to talk MAGI into something has no purchase on it.

---

## Things that are load-bearing

**The dataset's `crisis_level` is not a safety signal.** It labels "I can't concentrate today"
as Medium and "my period is making everything harder" as High — 45 of 80 intents are tagged
High/Crisis/Emergency. It is imported as `needIntensity` (how much support to offer) and is
kept strictly separate from risk. `risk.test.ts` asserts this gap so nobody re-conflates them.

**The 80 intents are the whole dataset.** The workbook's 70,400 rows are these 80 crossed with
10 neurotypes × 8 hormone phases × 11 age groups, and the generated context suffixes are often
incoherent (rows pair `Postmenopause` with "dealing with puberty"). The attribute grid is
applied as query-time metadata instead.

**Guardians cannot read conversations.** There are no guardian policies on `message`,
`conversation`, `magi_memory`, `check_in`, `signal_reading`, `healthcare_summary` or
`safety_plan`, and a schema test fails the build if one appears. A guardian is told that
concern arose; never what was said. Surveillance would stop young people being honest, which
is the only way the app helps them.

**No gamification.** There is no streak, points or badge column anywhere, and a schema test
greps for one. This is an explicit product non-goal and the guard is what keeps it one.

**Colour never carries text contrast.** Colour lives in surfaces, washes and the orb; text
sits on audited pairs. That is what lets the app stay vivid while text reaches AAA. Adding a
colour by hand fails `audit:a11y`; adding a non-compliant token fails `build:theme`.

---

## Before beta

- [ ] Apply migrations to the client's Supabase project — paste `supabase/apply-all.sql`
      into the SQL editor (the project is not in the Mindlabs Supabase account, so
      `supabase db push` and the connector cannot reach it) — then `npm run embed:intents`
- [ ] Set `OPENAI_API_KEY` as an edge function secret: `supabase secrets set OPENAI_API_KEY=...`
- [ ] `npm run smoke:llm` from a machine with a route to api.openai.com, to confirm the
      model id and parameters. Neither sandbox this was built in could reach OpenAI, so the
      OpenAI path is written defensively but has not been executed against the live API
- [ ] `guardian-invite` edge function — mints and emails the consent token (referenced by
      `app/guardian.tsx`, not yet written)
- [ ] Guardian notification worker — drains `guardian_notification` where
      `delivery_state = 'queued'`
- [ ] Erasure worker — acts on `data_request` where `kind = 'erasure'`
- [ ] Clinical review of the 80 intents: `scenario_intent.review_state` is `'pending'` for all
      of them, and of `crisis-resources.ts`, which carries a review date
- [ ] DPIA — the schema is built for it; `signal_definition.privacy_level` marks the 19
      Article 9 signals
- [ ] Screen reader passes on VoiceOver and TalkBack. The audit script prevents forgetting;
      it does not replace using the thing with your eyes shut
