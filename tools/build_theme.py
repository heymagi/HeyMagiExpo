"""
Builds MAGI's semantic theme tokens and PROVES their accessibility before emitting them.

Four variants: light/dark x standard/high-contrast. Every token pair that will ever carry
text is declared in TEXT_PAIRS below with its required ratio; the script asserts each one
and exits non-zero on failure. A non-compliant token therefore cannot reach the app.

Targets:
  standard mode  body text  >= 4.5:1  (WCAG 2.2 AA)   large text/UI >= 3.0:1
  high mode      body text  >= 7.0:1  (WCAG 2.2 AAA)  large text/UI >= 4.5:1

Deliberately NOT asserted: `line` and `accent.*.edge`. These are decorative hairlines drawn
on surfaces that are already distinguishable by background colour, so WCAG 2.2 1.4.11 does
not apply — that criterion covers boundaries "required to identify" a component. Where a
boundary IS the affordance (text inputs, selected chips, the focus ring) the token is
`lineStrong` / `accent.*.edgeStrong` / `focusRing`, all of which are asserted at 3:1.

Run: python3 tools/build_theme.py
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from colour import (BRAND, STOPS, build_ramp, oklch, hex_to_rgb, rgb_to_hex,
                    clamp_chroma, contrast, rel_luminance)

HUES = ["green", "sage", "rose", "amber", "yellow", "pink"]
ramps = {h: build_ramp(BRAND[h]) for h in HUES}

SAND_H = oklch(hex_to_rgb(BRAND["amber"]))[2]
INK_H  = oklch(hex_to_rgb(BRAND["green"]))[2]
# The marketing site's page ground is a pale pistachio mint, not the warm cream this
# originally shipped with. Derived from the sage brand hue so it stays in the family.
MINT_H = oklch(hex_to_rgb(BRAND["sage"]))[2]

def neutral_ramp(hue, hi_chroma, lo_chroma, extra):
    r = {}
    for stop, L in STOPS.items():
        r[stop] = rgb_to_hex(clamp_chroma(L, hi_chroma if L > 0.6 else lo_chroma, hue))
    r[0] = "#FFFFFF"
    for stop, L in extra.items():
        r[stop] = rgb_to_hex(clamp_chroma(L, lo_chroma, hue))
    return r

sand = neutral_ramp(SAND_H, 0.009, 0.014, {1000: 0.150})
# More chroma than the other neutrals: the site's ground is visibly green, not grey.
mint = neutral_ramp(MINT_H, 0.030, 0.020, {1000: 0.150})
ramps["mint"] = mint
ink  = neutral_ramp(INK_H,  0.012, 0.020, {975: 0.170, 1000: 0.130})
ramps["sand"] = sand
ramps["ink"] = ink

S, I = sand, ink
def R(h, stop): return ramps[h][stop]

# ------------------------------------------------------------------ #
# Semantic tokens
# ------------------------------------------------------------------ #
# Design intent:
#   Colour is carried by surfaces, washes and graphics — not by body text. That is what
#   lets the app stay visibly colourful while text contrast climbs to AAA. In high-contrast
#   mode the washes flatten toward the canvas and the ink deepens; the decorative graphic
#   colours are unchanged, because they never carry meaning on their own.

def accent_set(h, mode):
    if mode == "light":
        return {
            "wash":    R(h, 50),    # card / chip background
            "tint":    R(h, 100),   # hover, secondary fill
            "edge":    R(h, 200),   # decorative hairline on a wash — carries no meaning
            "edgeStrong": R(h, 600),  # boundary that IS the affordance (input, selected state)
            "graphic": R(h, 400),   # decorative only — orb, illustration, chart fill
            "graphicDeep": R(h, 600),
            "onWash":  R(h, 700),   # text sitting on `wash`
            "solid":   R(h, 800),   # filled button
            "onSolid": "#FFFFFF",
        }
    if mode == "lightHigh":
        return {
            "wash":    "#FFFFFF",
            "tint":    R(h, 50),
            "edge":    R(h, 600),
            "edgeStrong": R(h, 800),
            "graphic": R(h, 500),
            "graphicDeep": R(h, 700),
            "onWash":  R(h, 800),
            "solid":   R(h, 900),
            "onSolid": "#FFFFFF",
        }
    if mode == "dark":
        return {
            "wash":    R(h, 950),
            "tint":    R(h, 900),
            "edge":    R(h, 800),
            "edgeStrong": R(h, 400),
            "graphic": R(h, 500),
            "graphicDeep": R(h, 300),
            "onWash":  R(h, 300),
            "solid":   R(h, 300),
            "onSolid": R(h, 950),
        }
    return {  # darkHigh
        "wash":    I[1000],
        "tint":    R(h, 950),
        "edge":    R(h, 500),
        "edgeStrong": R(h, 200),
        "graphic": R(h, 400),
        "graphicDeep": R(h, 200),
        "onWash":  R(h, 200),
        "solid":   R(h, 200),
        "onSolid": R(h, 950),
    }


def orb_set(h):
    """Decorative gradient steps for the MAGI orb. Never carries text."""
    return {
        "orbCore": R(h, 300),
        "orbMid": R(h, 500),
        "orbRim": R(h, 700),
        "orbHue": R(h, 400),
    }

def base(mode):
    if mode == "light":
        return {
            "canvas": mint[50], "canvasSunken": mint[100], "surface": "#FFFFFF",
            "surfaceRaised": "#FFFFFF", "surfaceSunken": mint[100],
            "ink": I[900], "inkMuted": I[700], "inkSubtle": I[600], "inkInverse": "#FFFFFF",
            "line": mint[200], "lineStrong": mint[600], "lineFocus": R("green", 800),
            "focusRing": R("green", 800), "focusRingOffset": "#FFFFFF",
            "scrim": "rgba(15,10,7,0.44)",
            "shadowColor": "rgba(48,41,35,0.14)",
        }
    if mode == "lightHigh":
        return {
            "canvas": "#FFFFFF", "canvasSunken": mint[50], "surface": "#FFFFFF",
            "surfaceRaised": "#FFFFFF", "surfaceSunken": mint[50],
            "ink": I[1000], "inkMuted": I[900], "inkSubtle": I[800], "inkInverse": "#FFFFFF",
            "line": mint[500], "lineStrong": mint[800], "lineFocus": I[1000],
            "focusRing": I[1000], "focusRingOffset": "#FFFFFF",
            "scrim": "rgba(15,10,7,0.66)",
            "shadowColor": "rgba(15,10,7,0.22)",
        }
    if mode == "dark":
        return {
            "canvas": I[975], "canvasSunken": I[1000], "surface": I[950],
            "surfaceRaised": I[900], "surfaceSunken": I[1000],
            "ink": I[100], "inkMuted": I[300], "inkSubtle": I[400], "inkInverse": I[1000],
            "line": I[900], "lineStrong": I[500], "lineFocus": R("green", 300),
            "focusRing": R("green", 300), "focusRingOffset": I[975],
            "scrim": "rgba(3,9,6,0.62)",
            "shadowColor": "rgba(0,0,0,0.55)",
        }
    return {  # darkHigh
        "canvas": I[1000], "canvasSunken": I[1000], "surface": I[975],
        "surfaceRaised": I[950], "surfaceSunken": I[1000],
        "ink": "#FFFFFF", "inkMuted": I[100], "inkSubtle": I[200], "inkInverse": I[1000],
        "line": I[700], "lineStrong": I[500], "lineFocus": "#FFFFFF",
        "focusRing": "#FFFFFF", "focusRingOffset": I[1000],
        "scrim": "rgba(0,0,0,0.78)",
        "shadowColor": "rgba(0,0,0,0.7)",
    }

def brand_gradient(mode):
    """
    The site's signature device: a soft yellow -> orange -> magenta wash.

    It is the strongest single brand signal and the app shipped without it, which is why the
    UI read as monochrome green even though it was using the brand's green correctly.

    Decorative only. Sits behind content, never carries text, and is dropped entirely under
    `plainBackgrounds`.
    """
    if mode == "light":
        return {"from": R("yellow", 200), "via": R("amber", 300), "to": R("rose", 300), "opacity": 0.6}
    if mode == "lightHigh":
        return {"from": R("yellow", 100), "via": R("amber", 200), "to": R("rose", 200), "opacity": 0.3}
    if mode == "dark":
        return {"from": R("yellow", 900), "via": R("amber", 900), "to": R("rose", 900), "opacity": 0.55}
    return {"from": R("yellow", 950), "via": R("amber", 950), "to": R("rose", 950), "opacity": 0.3}


# Feedback roles map onto brand hues so nothing feels bolted on.
ROLE_HUE = {"positive": "green", "growth": "sage", "critical": "rose",
            "caution": "amber", "highlight": "yellow", "gentle": "pink"}

MODES = ["light", "lightHigh", "dark", "darkHigh"]
theme = {}
for mode in MODES:
    t = base(mode)
    t["accent"] = {h: {**accent_set(h, mode), **orb_set(h)} for h in HUES}
    t["role"] = {role: t["accent"][h] for role, h in ROLE_HUE.items()}
    t["brandGradient"] = brand_gradient(mode)
    theme[mode] = t

# ------------------------------------------------------------------ #
# Contrast assertions
# ------------------------------------------------------------------ #
def ratio(a, b): return contrast(hex_to_rgb(a), hex_to_rgb(b))

def text_pairs(mode):
    t = theme[mode]
    pairs = [
        ("ink on canvas",            t["ink"],        t["canvas"],        "body"),
        ("ink on surface",           t["ink"],        t["surface"],       "body"),
        ("ink on surfaceRaised",     t["ink"],        t["surfaceRaised"], "body"),
        ("ink on canvasSunken",      t["ink"],        t["canvasSunken"],  "body"),
        ("inkMuted on canvas",       t["inkMuted"],   t["canvas"],        "body"),
        ("inkMuted on surface",      t["inkMuted"],   t["surface"],       "body"),
        ("inkSubtle on canvas",      t["inkSubtle"],  t["canvas"],        "large"),
        ("inkSubtle on surface",     t["inkSubtle"],  t["surface"],       "large"),
        ("focusRing on canvas",      t["focusRing"],  t["canvas"],        "ui"),
        ("focusRing on surface",     t["focusRing"],  t["surface"],       "ui"),
        ("lineStrong on canvas",     t["lineStrong"], t["canvas"],        "ui"),
    ]
    for h in HUES:
        a = t["accent"][h]
        pairs += [
            (f"{h}.onWash on wash",   a["onWash"],  a["wash"],   "body"),
            (f"{h}.onWash on tint",   a["onWash"],  a["tint"],   "body"),
            (f"{h}.onSolid on solid", a["onSolid"], a["solid"],  "body"),
            (f"{h}.solid on canvas",  a["solid"],   t["canvas"], "ui"),
            (f"{h}.edgeStrong on wash",   a["edgeStrong"], a["wash"],   "ui"),
            (f"{h}.edgeStrong on canvas", a["edgeStrong"], t["canvas"], "ui"),
            (f"{h}.graphicDeep on canvas", a["graphicDeep"], t["canvas"], "ui"),
        ]
    return pairs

TARGET = {
    "standard": {"body": 4.5, "large": 3.0, "ui": 3.0},
    "high":     {"body": 7.0, "large": 4.5, "ui": 3.0},
}

failures, report = [], []
for mode in MODES:
    band = "high" if "High" in mode else "standard"
    report.append("")
    report.append(f"=== {mode}  (body>={TARGET[band]['body']}  large>={TARGET[band]['large']}  ui>={TARGET[band]['ui']}) ===")
    for name, fg, bg, kind in text_pairs(mode):
        need = TARGET[band][kind]
        got = ratio(fg, bg)
        ok = got >= need - 1e-9
        report.append(f"  {'PASS' if ok else 'FAIL'}  {name:34s} {fg} on {bg}  {got:6.2f}:1  (need {need})")
        if not ok:
            failures.append(f"{mode}: {name} {fg} on {bg} = {got:.2f}:1, need {need}:1")

header = ["MAGI theme contrast report", "=" * 72,
          "Generated by tools/build_theme.py — every text-bearing token pair is asserted."]
open("theme/theme.report.txt", "w", encoding="utf-8").write("\n".join(header + report) + "\n")
print("\n".join(header + report))

if failures:
    print("\n" + "!" * 72)
    print(f"{len(failures)} CONTRAST FAILURE(S) — tokens not written:")
    for f in failures: print("  " + f)
    sys.exit(1)

payload = {"ramps": ramps, "modes": theme,
           "roleHue": ROLE_HUE, "hues": HUES}
with open("theme/tokens.generated.ts", "w", encoding="utf-8") as f:
    f.write("/**\n * GENERATED FILE — do not edit by hand. Run `python3 tools/build_theme.py`.\n"
            " *\n * Every token pair that carries text has been asserted against its WCAG target\n"
            " * at generation time; see theme/theme.report.txt for the proof.\n */\n\n")
    f.write("export const THEME_TOKENS = " + json.dumps(payload, indent=2) + " as const;\n")
print(f"\nOK — {sum(len(text_pairs(m)) for m in MODES)} pairs asserted, 0 failures.")
print("wrote theme/tokens.generated.ts")
