"""Ícono animado del servidor (GIF de 256x256): bustos de las chicas (desde el motor, solo lectura) -> cuadros (assets/servidor/icono.html
con Chrome, node scripts/render-servidor.mjs icono) -> GIF en bucle (assets/servidor/icono_animado.gif).
También deja icono_vista_previa.png (cuadros sueltos, para revisar sin abrir el GIF).
Uso: python scripts/make_icono.py"""
import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_stickers import load, square  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "assets", "servidor")
# Mismos encuadres que los emojis, con más aire (cabeza y hombros dentro del círculo).
BUSTS = {
    "teto": ("teto", "feliz_5.png", 0.5, 0.45, 0.95),
    "miku": ("miku", "feliz_11.png", 0.5, 0.45, 0.95),
    "luka": ("luka", "feliz_21.png", 0.5, 0.45, 0.95),
    "neru": ("neru", "r3d_feliz.png", 0.5, 0.45, 0.95),
}
FPS = 15
SIZE = 256  # Discord muestra el ícono a 128 px como mucho: 256 se ve nítido y pesa poco.
MAX_BYTES = 4 * 1024 * 1024  # liviano para que cargue rápido (y lejos del límite de Discord).


def main():
    busts = os.path.join(DIR, "icono_bustos")
    os.makedirs(busts, exist_ok=True)
    for name, (char, file, cx, cy, side) in BUSTS.items():
        square(load(char, file), cx, cy, side).resize((760, 760), Image.LANCZOS).save(os.path.join(busts, f"{name}.png"), optimize=True)
    subprocess.run(["node", os.path.join(ROOT, "scripts", "render-servidor.mjs"), "icono"], check=True)

    frames_dir = os.path.join(DIR, "icono_cuadros")
    files = sorted(f for f in os.listdir(frames_dir) if f.endswith(".png"))
    frames = [Image.open(os.path.join(frames_dir, f)).convert("RGB") for f in files]
    # Una paleta común para todo el bucle (sin parpadeo de colores entre cuadros).
    small = [f.resize((SIZE, SIZE), Image.LANCZOS) for f in frames]
    sheet = Image.new("RGB", (SIZE, SIZE * min(len(small), 12)))
    for n, f in enumerate(small[:: max(1, len(small) // 12)][:12]):
        sheet.paste(f, (0, SIZE * n))
    palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    gif = [f.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for f in small]
    out = os.path.join(DIR, "icono_animado.gif")
    gif[0].save(out, save_all=True, append_images=gif[1:], duration=round(1000 / FPS), loop=0, optimize=True)
    size = os.path.getsize(out)
    if size > MAX_BYTES:
        raise SystemExit(f"El GIF pesa {size / 1e6:.1f} MB: baja FPS o la duración")
    preview = Image.new("RGB", (512 * 4, 512))
    for n in range(4):
        preview.paste(frames[int((n + 0.6) * len(frames) / 4)], (512 * n, 0))
    preview.save(os.path.join(DIR, "icono_vista_previa.png"))
    print(f"ok assets/servidor/icono_animado.gif ({len(frames)} cuadros, {size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
