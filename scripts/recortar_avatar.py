"""Recorta una imagen cualquiera a un avatar cuadrado de 1024 px para Discord y deja una vista previa con el círculo.

Uso:
  python scripts/recortar_avatar.py <imagen> <salida.png> [--x 0.5] [--y 0.45] [--zoom 1.0]

--x / --y: centro del recorte en proporción de la imagen (0 = izquierda/arriba, 1 = derecha/abajo).
--zoom: 1.0 = el cuadrado más grande que cabe; 1.5 = acerca (cuadrado 1,5 veces más chico).
Vista previa: <salida>_vista.png, con lo que queda fuera del círculo de Discord oscurecido.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw

p = argparse.ArgumentParser()
p.add_argument("imagen")
p.add_argument("salida")
p.add_argument("--x", type=float, default=0.5)
p.add_argument("--y", type=float, default=0.45)
p.add_argument("--zoom", type=float, default=1.0)
a = p.parse_args()

im = Image.open(a.imagen).convert("RGB")
w, h = im.size
lado = round(min(w, h) / max(a.zoom, 1.0))
cx, cy = a.x * w, a.y * h
izq = min(max(round(cx - lado / 2), 0), w - lado)
arr = min(max(round(cy - lado / 2), 0), h - lado)
avatar = im.crop((izq, arr, izq + lado, arr + lado)).resize((1024, 1024), Image.LANCZOS)

salida = Path(a.salida)
salida.parent.mkdir(parents=True, exist_ok=True)
avatar.save(salida)

mascara = Image.new("L", (1024, 1024), 110)
ImageDraw.Draw(mascara).ellipse((0, 0, 1023, 1023), fill=255)
vista = Image.composite(avatar, Image.new("RGB", (1024, 1024), "black"), mascara)
vista.save(salida.with_name(salida.stem + "_vista.png"))
print(f"{salida}: recorte ({izq}, {arr}) de {lado} px de {w}x{h}")
