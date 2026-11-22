"""Arte de la Ruleta de Némesis (PLAN §3.12): cuadros de los B-rolls de «The Muzzle of Nemesis» del motor
(Proyecto1/assets/broll/broll_wrath_*.mp4, PV oficial de mothy, ilustración de Ichika) recortados a la franja de la
imagen (los clips traen arriba y abajo la versión difuminada). Solo lee el motor; escribe en assets/nemesis/.

Uso: npm run nemesis:arte   (necesita ffmpeg y Pillow; ENGINE_DIR o ../Proyecto1)
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ENGINE = Path(os.environ.get("ENGINE_DIR") or ROOT.parent / "Proyecto1")
OUT = ROOT / "assets" / "nemesis"

# archivo de salida -> (clip, segundo del cuadro)
CUADROS = {
    "mascara.png": ("broll_wrath_mascara.mp4", 5.0),  # con la máscara, apunta de frente
    "cortinas.png": ("broll_wrath_apunta_roja.mp4", 0.3),  # apunta de perfil frente a las cortinas rojas
}


def franja(img: Image.Image) -> Image.Image:
    """Recorta la franja nítida: las filas cuyo borde con la de arriba cambia de golpe (fin del difuminado)."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()

    def diff(y: int) -> float:
        return sum(abs(px[x, y] - px[x, y - 1]) for x in range(0, w, 4)) / (w / 4)

    rows = [(diff(y), y) for y in range(8, h - 8)]
    top = max((r for r in rows if r[1] < h // 2), default=(0, 0))[1]
    bottom = max((r for r in rows if r[1] > h // 2), default=(0, h))[1]
    return img.crop((0, top + 1, w, bottom - 1))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    broll = ENGINE / "assets" / "broll"
    for name, (clip, t) in CUADROS.items():
        src = broll / clip
        if not src.exists():
            sys.exit(f"No encuentro {src} (ENGINE_DIR)")
        with tempfile.TemporaryDirectory() as tmp:
            frame = Path(tmp) / "f.png"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(t), "-i", str(src), "-frames:v", "1", str(frame)], check=True)
            img = franja(Image.open(frame).convert("RGB"))
        img.save(OUT / name)
        print(f"{name}: {img.size[0]}x{img.size[1]} de {clip} ({t} s)")


if __name__ == "__main__":
    main()
