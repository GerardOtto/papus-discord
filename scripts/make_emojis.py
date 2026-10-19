"""Emojis exclusivos del servidor (beneficio de Puerro y superiores): las 5 insignias de los niveles
(assets/kofi/badge_*.png) y caras de las Vocaloids desde los avatares del motor (solo lectura).
Salida: assets/bots/emojis/<nombre>.png (128 px, transparentes). Los sube `npm run emojis`.
Uso: python scripts/make_emojis.py"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "bots", "emojis")
SIZE = 128

BADGES = {
    "puerro": "badge_1_puerro.png",
    "atun": "badge_2_atun.png",
    "baguette": "badge_3_baguette.png",
    "celular": "badge_4_celular.png",
    "triplebaka": "badge_5_triple_baka.png",
}
# nombre del emoji: (personaje, archivo del motor, centro x, centro y, lado) en fracciones del contenido visible.
FACES = {
    "teto_feliz": ("teto", "feliz_5.png", 0.5, 0.40, 0.80),
    "teto_drama": ("teto", "shocked.png", 0.5, 0.35, 0.70),
    "teto_risa": ("teto", "riendo.png", 0.5, 0.30, 0.60),
    "miku_wow": ("miku", "emocionado_5.png", 0.5, 0.40, 0.80),
    "miku_guino": ("miku", "feliz_11.png", 0.5, 0.40, 0.80),
    "miku_presume": ("miku", "presumido.png", 0.40, 0.24, 0.50),
    "luka_feliz": ("luka", "feliz.png", 0.5, 0.40, 0.80),
    "luka_nerd": ("luka", "nerd.png", 0.5, 0.30, 0.60),
    "luka_paz": ("luka", "feliz_21.png", 0.5, 0.40, 0.80),
    "neru_meh": ("neru", "neutral_2.png", 0.5, 0.40, 0.80),
    "neru_risa": ("neru", "r3d_riendo.png", 0.5, 0.40, 0.75),
    "neru_enojo": ("neru", "enojado.png", 0.5, 0.35, 0.70),
}


def square(img, cx, cy, side):
    box = img.getbbox()
    if box:
        img = img.crop(box)
    w, h = img.size
    s = int(min(w, h) * side)
    left = max(0, min(w - s, int(cx * w - s / 2)))
    top = max(0, min(h - s, int(cy * h - s / 2)))
    return img.crop((left, top, left + s, top + s))


def main():
    os.makedirs(OUT, exist_ok=True)
    chars = json.load(open(os.path.join(ENGINE, "config/characters.json"), encoding="utf-8"))["characters"]
    for name, file in BADGES.items():
        img = Image.open(os.path.join(ROOT, "assets/kofi", file)).convert("RGBA")
        img = img.crop(img.getbbox() or (0, 0, *img.size))
        img.thumbnail((SIZE, SIZE), Image.LANCZOS)
        out = Image.new("RGBA", (SIZE, SIZE))
        out.alpha_composite(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2))
        out.save(os.path.join(OUT, f"{name}.png"), optimize=True)
    for name, (cid, file, cx, cy, side) in FACES.items():
        img = Image.open(os.path.join(ENGINE, chars[cid]["avatarDir"], file)).convert("RGBA")
        square(img, cx, cy, side).resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, f"{name}.png"), optimize=True)
    print(f"ok {len(BADGES) + len(FACES)} emojis")


if __name__ == "__main__":
    main()
