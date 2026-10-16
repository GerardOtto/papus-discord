"""Iconos de la bandeja (scripts/tray.ps1): la cara de cada chica con un punto verde (bots en linea) y Neru en gris
con punto rojo (detenidos). Toma las caras de assets/bots/emojis (scripts/make_emojis.py).
Salida: assets/bots/tray/<nombre>.ico   Uso: python scripts/make_tray_icons.py"""
import os

from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMOJIS = os.path.join(ROOT, "assets", "bots", "emojis")
OUT = os.path.join(ROOT, "assets", "bots", "tray")
SIZE = 256
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]

ONLINE = {"teto_on": "teto_feliz", "miku_on": "miku_guino", "luka_on": "luka_feliz", "neru_on": "neru_risa"}
GREEN = (59, 201, 90)
RED = (232, 64, 64)


def badge(face, color, gray=False):
    img = Image.open(os.path.join(EMOJIS, f"{face}.png")).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    # Recorte circular para que se lea bien a 16 px.
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=255)
    if gray:
        rgb = ImageOps.grayscale(img).convert("RGBA")
        rgb.putalpha(img.split()[3])
        img = Image.blend(rgb, Image.new("RGBA", rgb.size, (40, 40, 40, 255)), 0.25)
    out = Image.new("RGBA", (SIZE, SIZE))
    out.paste(img, (0, 0), mask)
    # Punto de estado (abajo a la derecha), grande para que se note en la bandeja.
    d = ImageDraw.Draw(out)
    r = int(SIZE * 0.22)
    cx, cy = SIZE - r - 4, SIZE - r - 4
    d.ellipse((cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10), fill=(30, 31, 34, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color + (255,))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, face in ONLINE.items():
        badge(face, GREEN).save(os.path.join(OUT, f"{name}.ico"), sizes=SIZES)
    badge("neru_meh", RED, gray=True).save(os.path.join(OUT, "off.ico"), sizes=SIZES)
    print("ok iconos de la bandeja")


if __name__ == "__main__":
    main()
