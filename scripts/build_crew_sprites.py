"""Crew pixel-art sprites.

Stage 1 (needs raw/crew/*.jpg, the original drawings): detect the pixel grid of each drawing,
sample one colour per art pixel, drop the background and save a clean sprite to art/crew/<id>.png.
Mina's drawing is twice as fine as the others, so it is halved and its face and shirt print are redrawn by hand
(PATCH) to keep the glasses readable at the shared pixel density.
Stage 2 (needs only art/crew/*.png): apply the art-direction tweaks (TWEAK: skin tone, height), build the idle
animation frames (breathing, blinking) and write src/data/sprites.ts with each sheet as a PNG data URI, so the
game stays a single self-contained file.

    python3 scripts/build_crew_sprites.py          # both stages when raw/ exists, else stage 2 only
"""
import base64, io, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, ART, OUT = os.path.join(ROOT, 'raw/crew'), os.path.join(ROOT, 'art/crew'), os.path.join(ROOT, 'src/data/sprites.ts')

# id: (grid period x, grid period y in source px, inner sample fraction). Rin's drawing is finer than the
# other two, so it is sampled on a coarser grid to give all three the same pixel density on screen.
SRC = {'rin': (8.4, 8.4, 0.1), 'jeff': (19.75, 19.85, 0.25), 'sofie': (20.85, 22.7, 0.25), 'mina': (8.75, 8.685, 0.25)}
HALVE = {'mina'}
# Hand-drawn cells over the halved drawing: (row, col, 'cells...') with '.' = keep.
_PAL = {'f': '4b382a', 'G': '7d7a80', 'E': '1e0c08', 'b': '4a2216', '1': 'd88656', '2': 'ca7650', '3': 'b0603e',
        '4': '8e432c', 'B': 'c0583e', 'm': '8f4630', 'T': '3a3637', 'O': 'c96a20', 'o': 'a05825', 'U': '3a4a68',
        'K': 'c7849a', 'd': '2a2627'}
PATCH = {'mina': [
    (8, 6, '3 b b 1 1 b b 3'),   # brows
    (9, 6, 'G E 2 G G 2 E G'),   # eyes inside the glasses, bridge in the middle
    (10, 6, '2 G G 1 1 G G 2'),  # lower rims
    (11, 6, '3 B 1 1 1 1 B 3'),  # cheeks
    (12, 6, '. 3 1 m m 1 3 .'),  # mouth
    (13, 6, '. 4 3 2 2 3 4 .'),  # chin
    (19, 8, 'O O O U U'), (20, 8, 'O d O U d'), (21, 8, 'O O O U U'), (22, 8, 'K o d U U'), (23, 8, 'o o o o T'),  # tee print
]}
# Art direction on top of the drawings (applied in stage 2, so art/crew stays faithful to the source):
#   skin: per-channel factors for skin pixels inside `boxes` (row0, row1, col0, col1, inclusive), minus `not` boxes
#   grow / cut: rows to duplicate / remove, spread over the trousers so the legs change length evenly
TWEAK = {
    'jeff': {'skin': ((0.80, 0.66, 0.56), [(6, 18, 0, 20), (29, 34, 0, 8)], []), 'grow': [35, 37, 39, 41]},
    'rin': {'cut': [31, 34, 37, 40, 43, 46]},
    'mina': {'skin': ((0.66, 0.60, 0.58), [(3, 16, 0, 19), (23, 32, 0, 19)], [(19, 25, 7, 13)]), 'cut': [33, 44, 48]},
}
# rows above `waist` move 1 px on the breath frame; `eyes` are (row0, row1, col0, col1) boxes for blinking and
# `lids` single-pixel eyes that close to the colour at `lid`. Coordinates are on the drawing before TWEAK rows.
ANIM = {
    'jeff': {'waist': 33, 'eyes': [(10, 12, 10, 11), (10, 12, 15, 16)], 'skin': (13, 10)},
    'sofie': {'waist': 31, 'eyes': [(10, 12, 11, 12), (10, 12, 17, 18)], 'skin': (9, 14)},
    'rin': {'waist': 28, 'eyes': []},          # eyes are hidden under the fringe
    'mina': {'waist': 28, 'eyes': [], 'lids': [(9, 7), (9, 12)], 'lid': (11, 6)},
}


def label(mask):
    from scipy import ndimage as ndi
    return ndi.label(mask)


def fg_mask(a):
    from scipy import ndimage as ndi
    mx, mn = a.max(2), a.min(2)
    light = (mn > 200) & ((mx - mn) < 22)
    lab, _ = label(light)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ndi.binary_opening(~np.isin(lab, list(border)), iterations=2)


def phase(prof, p):
    best = (-1.0, 0.0)
    for o in np.arange(0, p, 0.25):
        pos = np.round(np.arange(o, len(prof) - 1, p)).astype(int)
        s = prof[pos[pos < len(prof)]].mean()
        if s > best[0]:
            best = (s, o)
    return best[1]


def extract(cid):
    px, py, fr = SRC[cid]
    a = np.asarray(Image.open(os.path.join(RAW, cid + '.jpg')).convert('RGB')).astype(int)
    m = fg_mask(a)
    ox = phase(np.abs(np.diff(a, axis=1)).sum(2).sum(0), px) + 1
    oy = phase(np.abs(np.diff(a, axis=0)).sum(2).sum(1), py) + 1
    xs, ys = np.arange(ox - px, a.shape[1], px), np.arange(oy - py, a.shape[0], py)
    img = np.zeros((len(ys), len(xs), 4), np.uint8)
    for j, y0 in enumerate(ys):
        for i, x0 in enumerate(xs):
            x1, x2 = max(int(round(x0 + px * fr)), 0), int(round(x0 + px * (1 - fr)))
            y1, y2 = max(int(round(y0 + py * fr)), 0), int(round(y0 + py * (1 - fr)))
            if x1 >= a.shape[1] or y1 >= a.shape[0]:
                continue
            x2, y2 = min(max(x2, x1 + 1), a.shape[1]), min(max(y2, y1 + 1), a.shape[0])
            blk, mk = a[y1:y2, x1:x2].reshape(-1, 3), m[y1:y2, x1:x2].reshape(-1)
            if mk.mean() > 0.5:
                img[j, i, :3], img[j, i, 3] = np.median(blk[mk], 0), 255
    img = crop(img)
    if cid == 'sofie':  # floor shadow and paper showing through the hair curls
        for j in range(img.shape[0]):
            for i in range(img.shape[1]):
                r, g, b, al = map(int, img[j, i])
                lum, sat = (r + g + b) / 3, max(r, g, b) - min(r, g, b)
                if al and ((j >= 45 and lum > 150 and sat < 30) or (8 <= j <= 30 and (i <= 4 or i >= 21) and lum > 200 and sat < 30)):
                    img[j, i, 3] = 0
        img = crop(img)
    if cid in HALVE:
        img = halve(img)
    for r, c, cells in PATCH.get(cid, []):
        for k, ch in enumerate(cells.split()):
            if ch != '.':
                h = _PAL[ch]
                img[r, c + k] = (int(h[:2], 16), int(h[2:4], 16), int(h[4:], 16), 255)
    img[img[:, :, 3] == 0] = 0  # no palette reduction: an 18-colour palette merged white cloth into skin
    Image.fromarray(img).save(os.path.join(ART, cid + '.png'))


def halve(n):
    """2x2 -> 1 pixel, keeping a real colour of the block (the one nearest its median) instead of blending."""
    a = np.pad(n, ((1, 2), (0, 2), (0, 0)))
    o = np.zeros((a.shape[0] // 2, a.shape[1] // 2, 4), np.uint8)
    for j in range(o.shape[0]):
        for i in range(o.shape[1]):
            b = a[2 * j:2 * j + 2, 2 * i:2 * i + 2].reshape(-1, 4).astype(int)
            op = b[b[:, 3] > 0]
            if len(op) >= 2:
                med = np.median(op[:, :3], 0)
                o[j, i] = op[np.argmin(((op[:, :3] - med) ** 2).sum(1))]
    return crop(o)


def tweak(a, tw):
    """Skin tone and height changes. Returns the new image and a function mapping old row numbers to new ones."""
    a = a.copy()
    if 'skin' in tw:
        f, boxes, nots = tw['skin']
        r, g, b, al = (a[:, :, k].astype(int) for k in range(4))
        m = (al > 0) & (r > g) & (g > b) & (r - b > 50) & (r > 60)
        inb = np.zeros(m.shape, bool)
        for r0, r1, c0, c1 in boxes:
            inb[r0:r1 + 1, c0:c1 + 1] = True
        for r0, r1, c0, c1 in nots:
            inb[r0:r1 + 1, c0:c1 + 1] = False
        m &= inb
        for k in range(3):
            ch = a[:, :, k].astype(float)
            ch[m] = np.round(ch[m] * f[k])
            a[:, :, k] = ch.astype(np.uint8)
    rows = []
    for j in range(a.shape[0]):
        if j in tw.get('cut', []):
            continue
        rows.append(j)
        if j in tw.get('grow', []):
            rows.append(j)
    shift = lambda j: sum(1 for k in rows if k < j)  # new index of old row j (rows above it after edits)
    return a[rows], shift


def crop(img):
    yy, xx = np.where(img[:, :, 3] > 0)
    return img[yy.min():yy.max() + 1, xx.min():xx.max() + 1]


def breathe(a, waist):
    b = a.copy()
    b[1:waist + 1] = np.where(a[0:waist, :, 3:4] > 0, a[0:waist], np.where(np.arange(1, waist + 1)[:, None, None] >= waist, a[1:waist + 1], 0))
    b[0] = 0
    return b


def blink(a, boxes, skin, dy=0):
    """Closed eye: the box turns to skin and its bottom row becomes a dark lash line."""
    b = a.copy()
    for r0, r1, c0, c1 in boxes:
        r0, r1 = r0 + dy, r1 + dy
        box = a[r0:r1 + 1, c0:c1 + 1]
        lash = box.reshape(-1, 4)[box[:, :, :3].astype(int).sum(2).argmin()]
        b[r0:r1, c0:c1 + 1] = skin
        b[r1, c0:c1 + 1] = lash
    return b


def build():
    lines = ['// Generated by scripts/build_crew_sprites.py from art/crew/*.png. Do not edit by hand.',
             '// Each sheet holds 4 frames side by side: 0 rest, 1 breath in (upper body 1 px lower), 2 blink, 3 breath + blink.',
             'export interface Sprite { w: number; h: number; frames: number; sheet: string }',
             'export const SPRITE: Record<string, Sprite> = {']
    for cid, an in ANIM.items():
        a, sh = tweak(np.asarray(Image.open(os.path.join(ART, cid + '.png')).convert('RGBA')), TWEAK.get(cid, {}))
        a = np.concatenate([np.zeros((1, a.shape[1], 4), np.uint8), a])  # 1 px headroom
        y = lambda j: sh(j) + 1
        w = a.shape[1]
        eyes = [(y(r0), y(r1), c0, c1) for r0, r1, c0, c1 in an['eyes']]
        f0, f1 = a, breathe(a, y(an['waist']))
        if eyes:
            skin = a[y(an['skin'][0]), an['skin'][1]].copy()
            f2, f3 = blink(f0, eyes, skin), blink(f1, eyes, skin, 1)
        elif an.get('lids'):
            lid = a[y(an['lid'][0]), an['lid'][1]].copy()
            f2, f3 = f0.copy(), f1.copy()
            for r, c in an['lids']:
                f2[y(r), c] = lid
                f3[y(r) + 1, c] = lid
        else:
            f2, f3 = f0, f1
        sheet = np.concatenate([f0, f1, f2, f3], axis=1)
        buf = io.BytesIO()
        Image.fromarray(sheet).save(buf, 'PNG', optimize=True)
        if os.path.isdir(RAW):  # 8x preview for eyeballing, kept out of the repo
            Image.fromarray(sheet).resize((sheet.shape[1] * 8, sheet.shape[0] * 8), Image.NEAREST).save(os.path.join(ROOT, 'raw/crew', cid + '.sheet8x.png'))
        uri = 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
        lines.append(f"  {cid}: {{ w: {w}, h: {a.shape[0]}, frames: 4, sheet: '{uri}' }},")
        print(cid, 'sprite', w, 'x', a.shape[0], 'sheet', len(buf.getvalue()), 'bytes')
    lines.append('};')
    open(OUT, 'w').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    os.makedirs(ART, exist_ok=True)
    if os.path.isdir(RAW) and '--no-extract' not in sys.argv:
        for cid in SRC:
            extract(cid)
    build()
