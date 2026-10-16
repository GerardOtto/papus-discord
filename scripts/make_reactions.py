"""Miniaturas (320 px, fondo transparente) de las reacciones que usan los mensajes de guía (content/canales.json),
desde los avatares del motor (solo lectura). Salida: assets/bots/reacciones/<bot>_<reaccion>.png
Uso: python scripts/make_reactions.py   (ENGINE_DIR por defecto ../Proyecto1)"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "bots", "reacciones")
SIZE = 320


def main():
    chars = json.load(open(os.path.join(ENGINE, "config/characters.json"), encoding="utf-8"))["characters"]
    guides = json.load(open(os.path.join(ROOT, "content/canales.json"), encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    done = set()
    for key, g in guides.items():
        if key.startswith("$"):
            continue
        bot, reaction = g["bot"], g["reaccion"]
        if (bot, reaction) in done:
            continue
        file = chars[bot]["reactions"].get(reaction) or chars[bot]["reactions"]["feliz"]
        img = Image.open(os.path.join(ENGINE, chars[bot]["avatarDir"], file)).convert("RGBA")
        box = img.getbbox()
        if box:
            img = img.crop(box)
        img.thumbnail((SIZE, SIZE), Image.LANCZOS)
        canvas = Image.new("RGBA", (SIZE, SIZE))
        canvas.alpha_composite(img, ((SIZE - img.width) // 2, SIZE - img.height))
        canvas.save(os.path.join(OUT, f"{bot}_{reaction}.png"), optimize=True)
        done.add((bot, reaction))
        print(f"ok {bot}_{reaction}")


if __name__ == "__main__":
    main()
