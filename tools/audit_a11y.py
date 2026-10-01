"""
Static accessibility and design-system audit.

Catches the class of mistake that a type checker cannot and a manual pass will eventually
miss: an unlabelled button, a hard-coded colour that has never been through the contrast
generator, a font size written as a literal, or font scaling switched off.

None of this replaces testing with a screen reader. It replaces *forgetting*.

Run: python3 tools/audit_a11y.py
Exit code 1 if anything fails.
"""

import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN_DIRS = ["app", "components", "contexts", "lib"]
SKIP_PARTS = {"node_modules", "_to_delete", ".expo"}

failures: list[str] = []
warnings: list[str] = []
stats = {"files": 0, "pressables": 0, "labels": 0}


def files():
    for d in SCAN_DIRS:
        for p in (ROOT / d).rglob("*.tsx"):
            if SKIP_PARTS & set(p.parts):
                continue
            yield p
        for p in (ROOT / d).rglob("*.ts"):
            if SKIP_PARTS & set(p.parts):
                continue
            yield p


def element_blocks(src: str, tag: str):
    """Yield (line_no, text) for each JSX opening tag of `tag`, brace-aware."""
    for m in re.finditer(rf"<{tag}\b", src):
        i = m.end()
        depth = 0
        while i < len(src):
            ch = src[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            elif ch == ">" and depth == 0:
                break
            i += 1
        yield src.count("\n", 0, m.start()) + 1, src[m.start() : i + 1]


# Interactive elements that must carry an accessible name.
INTERACTIVE = ["Pressable", "TouchableOpacity", "TouchableHighlight", "Switch", "TextInput"]

# Colour must come from the generated tokens. These are the only literals allowed.
COLOUR_ALLOWLIST = {"#FFFFFF", "#fff", "#FFF", "transparent", "none"}

for path in files():
    src = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    stats["files"] += 1

    # ---- interactive elements need an accessible name ----
    for tag in INTERACTIVE:
        for line, block in element_blocks(src, tag):
            stats["pressables"] += 1
            has_label = "accessibilityLabel" in block or "aria-label" in block
            # A Pressable whose only child is text is still not self-labelling in RN.
            if has_label:
                stats["labels"] += 1
            else:
                failures.append(
                    f"{rel}:{line}  <{tag}> has no accessibilityLabel"
                )

    # ---- Pressables need a role so assistive tech announces them as actionable ----
    for line, block in element_blocks(src, "Pressable"):
        if "accessibilityRole" not in block:
            failures.append(f"{rel}:{line}  <Pressable> has no accessibilityRole")

    # ---- iOS-only a11y props leak into the DOM on web ----
    for m in re.finditer(r"accessibilityElementsHidden", src):
        line = src.count("\n", 0, m.start()) + 1
        failures.append(
            f"{rel}:{line}  accessibilityElementsHidden is iOS-only and leaks into the DOM "
            f"on web — use aria-hidden, which React Native maps per platform"
        )

    # ---- font scaling must never be switched off ----
    for m in re.finditer(r"allowFontScaling\s*=\s*\{?\s*false", src):
        line = src.count("\n", 0, m.start()) + 1
        failures.append(f"{rel}:{line}  allowFontScaling is disabled — breaks WCAG 1.4.4")

    # ---- no hard-coded colours outside the theme ----
    if not rel.startswith("theme/"):
        for m in re.finditer(r"['\"](#[0-9a-fA-F]{3,8})['\"]", src):
            value = m.group(1)
            if value in COLOUR_ALLOWLIST:
                continue
            line = src.count("\n", 0, m.start()) + 1
            failures.append(
                f"{rel}:{line}  hard-coded colour {value} — has not been through the contrast audit"
            )
        for m in re.finditer(r"(rgba?\([^)]*\))", src):
            line = src.count("\n", 0, m.start()) + 1
            warnings.append(f"{rel}:{line}  literal {m.group(1)} — prefer a theme token")

    # ---- no literal font sizes outside the type scale ----
    if not rel.startswith("theme/"):
        for m in re.finditer(r"fontSize:\s*(\d+)", src):
            line = src.count("\n", 0, m.start()) + 1
            failures.append(
                f"{rel}:{line}  literal fontSize {m.group(1)} — must come from t.type()"
            )

    # ---- touch targets must not be pinned below the minimum ----
    for m in re.finditer(r"(minHeight|minWidth|height|width):\s*(\d+)", src):
        prop, value = m.group(1), int(m.group(2))
        if prop in ("minHeight", "minWidth") and value < 44:
            line = src.count("\n", 0, m.start()) + 1
            failures.append(
                f"{rel}:{line}  {prop}: {value} is below the 44px minimum target size"
            )

# ---- decorative icons must be hidden from assistive tech ----
for path in files():
    src = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    for icon in re.finditer(r"<([A-Z][A-Za-z0-9]*)\s+size=\{?\d+", src):
        name = icon.group(1)
        if name in ("MagiOrb",):
            continue
        i = icon.end()
        depth = 0
        while i < len(src) and not (src[i] == ">" and depth == 0):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
            i += 1
        block = src[icon.start() : i + 1]
        hidden = any(
            marker in block
            for marker in ('aria-hidden', 'importantForAccessibility', 'accessibilityElementsHidden')
        )
        if not hidden:
            line = src.count("\n", 0, icon.start()) + 1
            warnings.append(
                f"{rel}:{line}  <{name}> icon is not hidden from assistive tech (add aria-hidden)"
            )

print("MAGI accessibility audit")
print("=" * 72)
print(
    f"scanned {stats['files']} files · {stats['pressables']} interactive elements · "
    f"{stats['labels']} labelled"
)

if warnings:
    print(f"\n{len(warnings)} warning(s):")
    for w in warnings:
        print("  " + w)

if failures:
    print(f"\n{len(failures)} FAILURE(S):")
    for f in failures:
        print("  " + f)
    sys.exit(1)

print("\nno failures.")
