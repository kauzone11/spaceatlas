"""Builds the planet textures: files in public/textures/ (standard set, 2048 px or less) and public/textures/hd/ (4096 px, loaded
only on capable desktops), and src/data/worlds.ts with their paths. scripts/package.mjs inlines the standard set into the
single-file artifact build; the web build serves the files and loads each one the first time a body needs it.
Sources (raw/worlds/):
- NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720): lroc_color_poles_4k.tif (LRO WAC colour), ldem_4.tif (LOLA elevation, km). Public domain.
- Solar System Scope textures (solarsystemscope.com/textures, CC BY 4.0, derived from NASA data): Earth day/clouds/night/specular,
  Mars (colour re-graded to the NASA Viking mosaic in raw/mars.jpg), Mercury, Venus, Jupiter, Saturn + rings, Uranus, Neptune, Sun.
"""
import base64, io, os
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None
R = os.path.join(os.path.dirname(__file__), '..', 'raw'); W = os.path.join(R, 'worlds'); OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'worlds.ts')
PUB = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures'); os.makedirs(os.path.join(PUB, 'hd'), exist_ok=True)
FILES = {}
def save(key, im, q, hd=False):
    """WebP for colour (about a third of JPEG at equal quality); greyscale stays JPEG (WebP has no greyscale mode)."""
    grey = im.mode == 'L'; ext = 'jpg' if grey else 'webp'; rel = ('hd/' if hd else '') + f'{key}.{ext}'
    path = os.path.join(PUB, rel)
    if grey: im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    elif im.mode == 'RGBA': im.save(path, 'WEBP', lossless=True, method=6)
    else: im.save(path, 'WEBP', quality=q, method=6)
    FILES.setdefault(key, {})['hd' if hd else 'sd'] = 'textures/' + rel
def half(im): return im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
def enc(im, fmt='JPEG', q=78): return im
def load(f, size=None, mode='RGB'):
    im = Image.open(os.path.join(W, f)).convert(mode)
    return im.resize(size, Image.LANCZOS) if size else im
def lab_match(src, ref):
    """Match per-channel mean/std of src to ref (both RGB float arrays) in a simple decorrelated space."""
    s = src.reshape(-1, 3); r = ref.reshape(-1, 3)
    out = (s - s.mean(0)) / (s.std(0) + 1e-6) * r.std(0) + r.mean(0)
    return np.clip(out.reshape(src.shape), 0, 255)
def normal_from_height(h, strength):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * strength, gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))
T = {}
e4 = load('8k_earth_daymap.jpg', (4096, 2048)); save('earth', half(e4), 82); save('earth', e4, 80, hd=True)
c4 = load('8k_earth_clouds.jpg', (4096, 2048), 'L'); save('clouds', half(c4), 62); save('clouds', c4, 60, hd=True)
save('night', load('8k_earth_nightmap.jpg', (2048, 1024), 'L'), 70)
save('water', load('2k_earth_specular_map.tif', (1024, 512), 'L'), 70)
m4 = load('lroc_color_poles_4k.tif', (4096, 2048)); save('moon', half(m4), 80); save('moon', m4, 76, hd=True)
dem = np.array(Image.open(os.path.join(W, 'ldem_4.tif')), dtype=np.float32)  # km, 1440x720
# the elevation grid is 1440x720: a larger normal map only adds bytes, not relief
dem = np.array(Image.fromarray(dem).resize((1024, 512), Image.BICUBIC))
save('moonN', normal_from_height(dem, 9.0 * 1024 / 2048), 80)
# detail (luminance) from the 8k map, colour from the NASA Viking mosaic
sss = load('8k_mars.jpg', (4096, 2048)).convert('YCbCr'); ref = Image.open(os.path.join(R, 'mars.jpg')).convert('RGB').resize((4096, 2048), Image.LANCZOS).convert('YCbCr')
y = np.asarray(sss, dtype=np.float32)[..., 0]; ry = np.asarray(ref, dtype=np.float32)
y = (y - y.mean()) / (y.std() + 1e-6) * ry[..., 0].std() + ry[..., 0].mean()
ycc = np.dstack([np.clip(y, 0, 255), ry[..., 1], ry[..., 2]]).astype(np.uint8)
marsim = Image.fromarray(ycc, 'YCbCr').convert('RGB'); mars = np.asarray(marsim); save('mars', half(marsim), 82); save('mars', marsim, 78, hd=True)
lum = np.asarray(Image.fromarray(mars).convert('L').resize((2048, 1024), Image.LANCZOS), dtype=np.float32) / 255

hp = lum - np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), dtype=np.float32) / 255
k1 = np.exp(-np.arange(-3, 4) ** 2 / (2 * 1.2 ** 2)); k1 /= k1.sum()  # small Gaussian to suppress JPEG noise
hp = np.apply_along_axis(lambda r: np.convolve(r, k1, 'same'), 1, hp); hp = np.apply_along_axis(lambda c: np.convolve(c, k1, 'same'), 0, hp)
save('marsN', normal_from_height(hp, 40.0).resize((1024, 512), Image.LANCZOS), 78)
for k, f in [('mercury', '2k_mercury.jpg'), ('venus', '2k_venus_atmosphere.jpg'), ('jupiter', '2k_jupiter.jpg'), ('saturn', '2k_saturn.jpg'), ('uranus', '2k_uranus.jpg'), ('neptune', '2k_neptune.jpg')]:
    save(k, load(f, (1024, 512)), 74)
save('sun', load('2k_sun.jpg', (1024, 512)), 76)
save('ring', Image.open(os.path.join(W, '2k_saturn_ring_alpha.png')).convert('RGBA').resize((1024, 64), Image.LANCZOS), 90)
import json
with open(OUT, 'w') as f:
    f.write('// Generated by scripts/build_worlds.py. NASA SVS (public domain) and Solar System Scope (CC BY 4.0) textures. Do not edit.\n')
    f.write('// Paths relative to the page: sd = standard set (always), hd = 4096-px maps for capable desktops.\n')
    f.write('export const WORLD_FILES: Record<string, { sd: string; hd?: string }> = ' + json.dumps(FILES) + ';\n')
sizes = {k: {q: os.path.getsize(os.path.join(PUB, v[len('textures/'):])) // 1024 for q, v in d.items()} for k, d in FILES.items()}
print(sizes); print('sd total KB', sum(v['sd'] for v in sizes.values()), 'hd total KB', sum(v.get('hd', 0) for v in sizes.values()))
