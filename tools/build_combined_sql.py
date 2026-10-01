"""
Concatenates the migrations into one file for pasting into the Supabase SQL editor.

Needed because the MAGI Supabase project is not in the Mindlabs Supabase account, so the
connector cannot reach it and `supabase db push` needs the project linked locally. One
paste-able file is the shortest path to a working database.

Run: python3 tools/build_combined_sql.py
Output: supabase/apply-all.sql
"""

import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
TARGET = ROOT / "supabase" / "apply-all.sql"

header = f"""/*
  MAGI — all {len(MIGRATIONS)} migrations, in order, as one script.

  GENERATED FILE: run `python3 tools/build_combined_sql.py` to rebuild.

  How to use:
    1. Open the Supabase dashboard for the MAGI project -> SQL Editor -> New query.
    2. Paste this entire file and run it.
    3. Then, locally:  npm run embed:intents

  It is safe to run against an EMPTY project. It is NOT idempotent as a whole: the CREATE
  TYPE and CREATE TABLE statements will error on a second run. The seed data at the end is
  idempotent on its own (ON CONFLICT DO UPDATE), so re-seeding after a content change means
  running just the final section.

  Requires the `vector` extension, which Supabase provides. If the CREATE EXTENSION line
  fails, enable "vector" under Database -> Extensions first.

  One statement needs owner rights and will only work as the dashboard's postgres role:
  the trigger on auth.users that provisions an account row on sign-up.
*/

"""

parts = [header]
for path in MIGRATIONS:
    parts.append("\n\n")
    parts.append("-- " + "=" * 74 + "\n")
    parts.append(f"-- {path.name}\n")
    parts.append("-- " + "=" * 74 + "\n\n")
    parts.append(path.read_text(encoding="utf-8").strip())
    parts.append("\n")

TARGET.write_text("".join(parts), encoding="utf-8")
lines = TARGET.read_text(encoding="utf-8").count("\n")
print(f"wrote {TARGET.relative_to(ROOT)} — {len(MIGRATIONS)} migrations, {lines} lines")
for p in MIGRATIONS:
    print(f"  {p.name}")
