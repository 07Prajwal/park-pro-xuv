#!/usr/bin/env python3
"""
Download and optimise the CC0 assets used by the game (from Poly Haven, https://polyhaven.com,
all CC0 - no attribution required). Outputs go to public/assets/ and are committed, so a
normal `npm run build` never needs the network. Re-run only to change or refresh assets.

Requires: Python 3.8+, Pillow with WebP support.
Behind a TLS-intercepting proxy, set SSL_CERT_FILE to a CA bundle that includes the proxy root.

Texture packing: Three.js reads aoMap from R and roughnessMap from G, so AO + roughness are
packed into one "ORM" image (R = AO, G = roughness, B = 0) to save a download and a texture unit.
"""
import io
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
PH = 'https://dl.polyhaven.org/file/ph-assets'

# name -> (poly haven id, resolution)
TEXTURES = {
    'asphalt': ('asphalt_02', '2k'),
    'grass': ('sparse_grass', '1k'),
    'concrete': ('concrete_floor_worn_001', '1k'),
    'brick': ('red_brick_03', '1k'),
    'plaster': ('beige_wall_001', '1k'),
    'pavers': ('interlocking_concrete_pavers', '1k'),
}
HDRI_ID = 'kloofendal_48d_partly_cloudy_puresky'


def fetch(url: str) -> bytes:
    print('  GET', url)
    with urllib.request.urlopen(url) as r:
        return r.read()


def img(url: str) -> Image.Image:
    return Image.open(io.BytesIO(fetch(url)))


def main() -> None:
    """Fetch everything, or only the texture names given on the command line (e.g. `brick plaster`)."""
    only = set(sys.argv[1:])
    os.makedirs(os.path.join(ROOT, 'textures'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'hdri'), exist_ok=True)

    for name, (pid, res) in TEXTURES.items():
        if only and name not in only:
            continue
        print(name)
        base = f'{PH}/Textures/jpg/{res}/{pid}/{pid}'
        diff = img(f'{base}_diff_{res}.jpg').convert('RGB')
        nor = img(f'{base}_nor_gl_{res}.jpg').convert('RGB')
        rough = img(f'{base}_rough_{res}.jpg').convert('L')
        ao = img(f'{base}_ao_{res}.jpg').convert('L')
        black = Image.new('L', rough.size, 0)
        orm = Image.merge('RGB', (ao.resize(rough.size), rough, black))
        out = os.path.join(ROOT, 'textures', name)
        diff.save(f'{out}_diff.webp', 'WEBP', quality=82, method=6)
        nor.save(f'{out}_nor.webp', 'WEBP', quality=90, method=6)
        orm.save(f'{out}_orm.webp', 'WEBP', quality=85, method=6)

    if only:
        return
    print('hdri')
    # 1k HDR for image-based lighting (PMREM blurs it anyway).
    with open(os.path.join(ROOT, 'hdri', 'sky_1k.hdr'), 'wb') as f:
        f.write(fetch(f'{PH}/HDRIs/hdr/1k/{HDRI_ID}_1k.hdr'))
    # Sharp 4k LDR version for the visible sky background.
    sky = img(f'{PH}/HDRIs/extra/Tonemapped%20JPG/{HDRI_ID}.jpg').convert('RGB')
    sky = sky.resize((4096, 2048), Image.LANCZOS)
    sky.save(os.path.join(ROOT, 'hdri', 'sky_bg.webp'), 'WEBP', quality=80, method=6)

    total = 0
    for dp, _, files in os.walk(ROOT):
        for fn in files:
            total += os.path.getsize(os.path.join(dp, fn))
    print(f'done, total {total / 1e6:.1f} MB')


if __name__ == '__main__':
    sys.exit(main())
