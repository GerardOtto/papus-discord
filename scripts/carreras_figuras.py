"""Figuras de Teto, Miku, Luka y Neru para el banner «¡Se abren las apuestas!» de las carreras (PLAN §3.14).
Cada versión es un gesto distinto; se elige una al azar en cada carrera. Imágenes del motor (solo lectura), sin trajes
de temporada, recortadas a lo visible y reducidas a 720 px de alto como máximo.
Salida: assets/carreras/figuras/<version>_<bot>.png
Uso: python scripts/carreras_figuras.py"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "carreras", "figuras")
MAX_H = 720

# versión: {bot: archivo del motor (assets/characters/<bot>/)}
VERSIONES = {
    "euforia": {"teto": "emocionado_4.png", "miku": "emocionado_10.png", "luka": "emocionado_5.png", "neru": "r3d_emocionado_6.png"},
    "saludo": {"teto": "saludando_4.png", "miku": "saludando_5.png", "luka": "saludando_2.png", "neru": "r3d_saludando.png"},
    "corazones": {"teto": "feliz_8.png", "miku": "feliz_15.png", "luka": "feliz_3.png", "neru": "feliz.png"},
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for version, bots in VERSIONES.items():
        for bot, name in bots.items():
            img = Image.open(os.path.join(ENGINE, "assets", "characters", bot, name)).convert("RGBA")
            img = img.crop(img.getbbox())
            if img.height > MAX_H:
                img = img.resize((round(img.width * MAX_H / img.height), MAX_H), Image.LANCZOS)
            img.save(os.path.join(OUT, f"{version}_{bot}.png"), optimize=True)
        print(f"ok {version}")


if __name__ == "__main__":
    main()
