"""Colour maths and brand ramp construction for the MAGI theme build."""
import math

BRAND = {
    "green":  "#0C5D3F",
    "sage":   "#9DC18B",
    "rose":   "#DD4E75",
    "amber":  "#F68E2A",
    "yellow": "#F8D76D",
    "pink":   "#F6A4B2",
}

# ---------- colour maths ----------
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def rgb_to_hex(rgb):
    return "#" + "".join(f"{max(0,min(255,round(c*255))):02X}" for c in rgb)

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

def rgb_to_oklab(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb)
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_, m_, s_ = (math.copysign(abs(v) ** (1/3), v) for v in (l, m, s))
    return (
        0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
        1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
        0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_,
    )

def oklab_to_rgb(lab):
    L, a, b = lab
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = (v**3 for v in (l_, m_, s_))
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(linear_to_srgb(c) for c in (r, g, bb))

def oklch(rgb):
    L, a, b = rgb_to_oklab(rgb)
    return L, math.hypot(a, b), math.atan2(b, a)

def from_oklch(L, C, H):
    return oklab_to_rgb((L, C*math.cos(H), C*math.sin(H)))

def in_gamut(rgb):
    return all(-0.0005 <= c <= 1.0005 for c in rgb)

def clamp_chroma(L, C, H):
    """Reduce chroma until the colour is representable in sRGB."""
    lo, hi = 0.0, C
    for _ in range(28):
        mid = (lo + hi) / 2
        if in_gamut(from_oklch(L, mid, H)):
            lo = mid
        else:
            hi = mid
    return from_oklch(L, lo, H)

def rel_luminance(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb)
    return 0.2126*r + 0.7152*g + 0.0722*b

def contrast(a, b):
    la, lb = rel_luminance(a), rel_luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

# ---------- ramps ----------
# Perceptual lightness stops. 50 = palest wash, 900 = deepest ink.
STOPS = {50: 0.975, 100: 0.945, 200: 0.895, 300: 0.825, 400: 0.740,
         500: 0.650, 600: 0.560, 700: 0.470, 800: 0.375, 900: 0.285, 950: 0.215}

def build_ramp(hex_seed):
    L0, C0, H = oklch(hex_to_rgb(hex_seed))
    ramp = {}
    for stop, L in STOPS.items():
        # Chroma tapers at the extremes so pale tints stay tints and deep inks stay ink.
        taper = 1.0 - 2.1 * abs(L - 0.62) ** 1.75
        C = max(0.012, C0 * max(0.18, taper))
        ramp[stop] = rgb_to_hex(clamp_chroma(L, C, H))
    ramp["seed"] = hex_seed.upper()
    return ramp

def _int_stops(ramp):
    return sorted(s for s in ramp if isinstance(s, int))

def darkest_meeting(ramp, bg_hex, target):
    """Palest ramp stop that still meets `target` against bg — keeps as much colour as possible."""
    bg = hex_to_rgb(bg_hex)
    for stop in _int_stops(ramp):
        if contrast(hex_to_rgb(ramp[stop]), bg) >= target:
            return stop, ramp[stop]
    last = _int_stops(ramp)[-1]
    return last, ramp[last]

def lightest_meeting(ramp, bg_hex, target):
    """Deepest ramp stop that still meets `target` against a dark bg."""
    bg = hex_to_rgb(bg_hex)
    for stop in reversed(_int_stops(ramp)):
        if contrast(hex_to_rgb(ramp[stop]), bg) >= target:
            return stop, ramp[stop]
    first = _int_stops(ramp)[0]
    return first, ramp[first]

