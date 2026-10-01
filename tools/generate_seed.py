"""
Emits supabase/migrations/20260901100007_magi_seed.sql from the JSON in magi/data/.

Keeping seed SQL generated rather than hand-written means the app's TypeScript and the
database can never disagree about the intent taxonomy, the trackable signals or the
challenge library — they are produced from the same files.

Run: python3 tools/generate_seed.py
"""
import json, os, textwrap

def q(v):
    """Quote a scalar as a SQL literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def arr(values):
    if not values:
        return "'{}'"
    inner = ", ".join(q(v) for v in values)
    return f"ARRAY[{inner}]::text[]"

signals = json.load(open("magi/data/trackable-signals.json", encoding="utf-8"))
intents = json.load(open("magi/data/intents.json", encoding="utf-8"))
challenges = json.load(open("magi/data/challenges.json", encoding="utf-8"))

# ---------- signal_definition ----------
VALUE_TYPE = {
    "Numeric": ("numeric", None, None),
    "Percentage": ("numeric", 0, 100),
    "Scale (1-5)": ("scale", 1, 5),
    "Scale (1-10)": ("scale", 1, 10),
    "Boolean (Yes/No)": ("boolean", None, None),
    "Binary": ("boolean", None, None),
    "Binary/Date-based": ("boolean", None, None),
    "List": ("set", None, None),
    "Categorical": ("text", None, None),
}
ORDER_BASE = {"Critical": 10, "High": 30, "Nice to Have": 60, "Future": 90}

# Age is derived from account.date_of_birth, so it is not a user-tracked signal.
SKIP_SIGNALS = {"age_group_classification_16_100"}

signal_rows = []
for i, s in enumerate(signals):
    if s["id"] in SKIP_SIGNALS:
        continue
    vt, lo, hi = VALUE_TYPE[s["dataType"]]
    clinical = s.get("clinicalStandard") or ""
    clinical = None if clinical.startswith("No") else clinical
    signal_rows.append(
        f"  ({q(s['id'])}, {q(s['label'])}, {q(s['category'])}, {q(s['subcategory'])}, "
        f"{q(vt)}::signal_value_type, {q(lo)}, {q(hi)}, NULL, "
        f"{q(s['privacy'].lower())}, {q(clinical)}, "
        f"{ORDER_BASE[s['mvp']] + i}, {q(s['mvp'] == 'Critical')})"
    )

# ---------- scenario_intent ----------
intent_rows = [
    f"  ({q(it['id'])}, {q(it['phrase'])}, {q(it['category'])}, {it['needIntensity']}, "
    f"{q(it['dbtSkill'])}, {q(it['tone'])}, {q(it['somatic'])})"
    for it in intents
]

# ---------- challenge_template ----------
challenge_rows = [
    f"  ({q(c['id'])}, {q(c['title'])}, {q(c['invitation'])}, {q(c.get('detail'))}, "
    f"{q(c['category'])}, {q(c.get('dbt_skill'))}, {c['effort']}, {c['minutes']}, "
    f"{c['sensory_load']}, {q(c['low_capacity_safe'])}, {q(c['somatic'])}, "
    f"{arr(c['suits_neurotypes'])}, {c['min_age']})"
    for c in challenges
]

header = f"""/*
  MAGI — seed data.  GENERATED FILE: run `python3 tools/generate_seed.py` to regenerate.

  Sources:
    magi/data/trackable-signals.json  ({len(signal_rows)} signals, from the MAGI starter data framework)
    magi/data/intents.json            ({len(intent_rows)} intents, distilled from the training dataset)
    magi/data/challenges.json         ({len(challenge_rows)} challenges, authored for this build)

  Embeddings are NOT seeded here — vectors do not belong in version-controlled SQL. Run
  `npm run embed:intents` against the target project after applying migrations; it fills
  scenario_intent.embedding and is idempotent.

  All three tables are reference data: readable by any authenticated user, writable only
  by the service role. ON CONFLICT DO UPDATE so re-running is safe.
*/

"""

parts = [header]

parts.append("-- ============================================================\n"
             "-- TRACKABLE SIGNALS\n"
             "-- ============================================================\n\n"
             "INSERT INTO signal_definition\n"
             "  (id, label, category, subcategory, value_type, scale_min, scale_max, unit,\n"
             "   privacy_level, clinical_standard, display_order, offer_early)\n"
             "VALUES\n" + ",\n".join(signal_rows) + "\n"
             "ON CONFLICT (id) DO UPDATE SET\n"
             "  label = EXCLUDED.label,\n"
             "  category = EXCLUDED.category,\n"
             "  subcategory = EXCLUDED.subcategory,\n"
             "  value_type = EXCLUDED.value_type,\n"
             "  scale_min = EXCLUDED.scale_min,\n"
             "  scale_max = EXCLUDED.scale_max,\n"
             "  privacy_level = EXCLUDED.privacy_level,\n"
             "  clinical_standard = EXCLUDED.clinical_standard,\n"
             "  display_order = EXCLUDED.display_order,\n"
             "  offer_early = EXCLUDED.offer_early;\n")

parts.append("\n-- ============================================================\n"
             "-- SCENARIO INTENTS\n"
             "-- ============================================================\n"
             "-- need_intensity is how much support to offer. It is NOT a risk level;\n"
             "-- risk is assessed independently on every turn. See magi/risk.ts.\n\n"
             "INSERT INTO scenario_intent\n"
             "  (id, phrase, category, need_intensity, dbt_skill, tone, somatic)\n"
             "VALUES\n" + ",\n".join(intent_rows) + "\n"
             "ON CONFLICT (id) DO UPDATE SET\n"
             "  phrase = EXCLUDED.phrase,\n"
             "  category = EXCLUDED.category,\n"
             "  need_intensity = EXCLUDED.need_intensity,\n"
             "  dbt_skill = EXCLUDED.dbt_skill,\n"
             "  tone = EXCLUDED.tone,\n"
             "  somatic = EXCLUDED.somatic;\n")

parts.append("\n-- ============================================================\n"
             "-- CHALLENGE LIBRARY\n"
             "-- ============================================================\n"
             "-- No streak, consecutive-day or points column exists anywhere in this schema,\n"
             "-- and none should be added: gamification is an explicit product non-goal.\n\n"
             "INSERT INTO challenge_template\n"
             "  (id, title, invitation, detail, category, dbt_skill, effort, minutes,\n"
             "   sensory_load, low_capacity_safe, somatic, suits_neurotypes, min_age)\n"
             "VALUES\n" + ",\n".join(challenge_rows) + "\n"
             "ON CONFLICT (id) DO UPDATE SET\n"
             "  title = EXCLUDED.title,\n"
             "  invitation = EXCLUDED.invitation,\n"
             "  detail = EXCLUDED.detail,\n"
             "  category = EXCLUDED.category,\n"
             "  dbt_skill = EXCLUDED.dbt_skill,\n"
             "  effort = EXCLUDED.effort,\n"
             "  minutes = EXCLUDED.minutes,\n"
             "  sensory_load = EXCLUDED.sensory_load,\n"
             "  low_capacity_safe = EXCLUDED.low_capacity_safe,\n"
             "  somatic = EXCLUDED.somatic,\n"
             "  suits_neurotypes = EXCLUDED.suits_neurotypes,\n"
             "  min_age = EXCLUDED.min_age;\n")

out = "supabase/migrations/20260901100007_magi_seed.sql"
open(out, "w", encoding="utf-8").write("".join(parts))
print(f"wrote {out}")
print(f"  {len(signal_rows)} signals, {len(intent_rows)} intents, {len(challenge_rows)} challenges")
