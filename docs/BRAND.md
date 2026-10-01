# heymagi.com — measured, not eyeballed (2026-09-01)

Extracted by running JS in the live page: CSS custom properties, computed styles weighted by
painted area, and pixel-sampling the wordmark on a canvas.

## Palette (exact)
| role | hex | rgb | where it comes from |
|---|---|---|---|
| canvas / pistachio | #EBFCDC | 235,252,220 | `body` background, 6.2M px² — the single largest surface on the site |
| deep green | #065D3D | 6,93,61 | filled cards (2.6M px²) AND the primary text colour (575k px²) |
| sage | #A0C090 | 160,192,144 | the "A" of the wordmark and the mascot's body |
| cream | #F6F5F0 | 246,245,240 | secondary card surface (1.3M px²) |
| yellow | #F9D86D | 249,216,109 | filled panel (1.2M px²) + the "i" |
| orange | #F78F2A | 247,143,42 | gradient stop + the logo dots + mascot head |
| pink | #F7A5B3 | 247,165,179 | gradient stop |
| magenta | #DE4E75 | 222,78,117 | gradient stop + the "M" |

Text on the site is only ever `#065D3D` on pale, or white (incl. 80%/70% alpha) on `#065D3D`.
There is no other text colour. No dark mode exists on the site.

## The gradient — the thing I got wrong twice
    radial-gradient(circle at 0% 100%,
      #DE4E75, #F7A5B3 14%, #F78F2A, #F9D86D 44%, #EBFCDC 60%)
and its linear twin at `350deg`. It is a **corner glow radiating from bottom-left**, resolving
into the canvas colour by 60%. Not a horizontal band, and the hot end is at the BOTTOM.

## Type
Headings: Nunito 900 (22/35/40px). Body: Roboto 400 (14/16px).

## The mascot — already exists, and it is faceless
The wordmark's "A" is drawn as a 3D character: a rounded sage-green body, an orange sphere for
a head, and two smaller coral/orange spheres at the shoulders. It has **no face** — no eyes,
no mouth. On the site it floats free of the phone mockup.

## Assets
magi.webp (199x79, colour wordmark) · magi-white.png (164x65) · magi-favicon.png (1211 B)
