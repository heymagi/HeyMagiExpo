"""
Emits supabase/functions/_shared/intents.generated.ts from magi/data/intents.json.

TypeScript rather than JSON because the same module is imported by both Deno (edge functions)
and Metro (React Native), and the two disagree about JSON import syntax — Deno wants an
import attribute, Metro does not accept one. A generated .ts file sidesteps the argument.

Run: python3 tools/generate_data.py
"""

import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "magi" / "data" / "intents.json"
TARGET = ROOT / "supabase" / "functions" / "_shared" / "intents.generated.ts"

intents = json.loads(SOURCE.read_text(encoding="utf-8"))


def ts(value):
    return json.dumps(value, ensure_ascii=False)


lines = [
    "/**",
    " * GENERATED FILE — run `python3 tools/generate_data.py`.",
    " *",
    " * The 80 base intents distilled from magi_complete_training_dataset_5000plus.xlsx.",
    " * That workbook holds 70,400 rows, but they are these 80 intents crossed with 10",
    " * neurotypes x 8 hormone phases x 11 age groups; the expansion carries no extra signal",
    " * and its generated context suffixes are often incoherent for a given user.",
    " *",
    " * `needIntensity` is how much support to offer. It is NOT a risk level — see risk.ts.",
    " */",
    "",
    "export interface IntentRecord {",
    "  id: string;",
    "  phrase: string;",
    "  category: string;",
    "  needIntensity: 1 | 2 | 3 | 4 | 5;",
    "  /** The source workbook's own label, retained only for traceability. Do not branch on it. */",
    "  sourceCrisisLevel: string;",
    "  dbtSkill: string;",
    "  tone: string;",
    "  somatic: boolean;",
    "}",
    "",
    "export const INTENT_RECORDS: readonly IntentRecord[] = [",
]

for it in intents:
    lines.append(
        "  { id: %s, phrase: %s, category: %s, needIntensity: %d, sourceCrisisLevel: %s, "
        "dbtSkill: %s, tone: %s, somatic: %s },"
        % (
            ts(it["id"]),
            ts(it["phrase"]),
            ts(it["category"]),
            it["needIntensity"],
            ts(it["sourceCrisisLevel"]),
            ts(it["dbtSkill"]),
            ts(it["tone"]),
            "true" if it["somatic"] else "false",
        )
    )

lines += ["] as const;", ""]

TARGET.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {TARGET.relative_to(ROOT)} — {len(intents)} intents")
