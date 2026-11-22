"""Emojis de cara de los corredores de las carreras (PLAN §3.14) que todavía no tienen una en el pack gratis.
Mismo estilo que scripts/make_emoji_samples.py: cara en cuadrado, 128 px, fondo transparente. Abiertos a todos (un
bot no puede usar un emoji limitado a roles que no tiene), así que van en su propio pack: assets/emojis/carreras.
- Vocaloids del servidor (Rin, Len, Meiko, Adachi Rei, Ruko): una imagen de frente del motor (solo lectura), sin
  trajes de temporada (las de Navidad no), recortada a la cara.
- Invitados del motor (Ted, Nero, Lily, Defoko, KAFU, Momone Momo): el recorte de su avatar del 1vs1.
- Anon y Kanon: el recorte de la ilustración compartida que eligió GyroP (8 nov. 2026), con el mismo lado.
- Don Ramón, Godzilla, Shaula, Mango9374 y Meowl (fotos o capturas con fondo): su avatar del 1vs1 recortado en círculo.
- La Piña: dibujada como en su avatar, sin el fondo.
Escribe la clave "carreras" de assets/emojis/packs.json (lo que sube npm run emojis) y 00_vista_previa.png.
Uso: python scripts/make_emojis_carreras.py"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import peleas_avatares as pa  # noqa: E402
from make_emoji_samples import OUT, SIZE, fit  # noqa: E402
from make_stickers import load  # noqa: E402

DEST = os.path.join(OUT, "carreras")
LUCHADORES = os.path.join(pa.ROOT, "assets", "peleas", "luchadores")

# nombre del emoji: (carpeta del motor, archivo, centro x, centro y, lado), como en el avatar del bot o del 1vs1.
MOTOR = {
    "rin_cara": ("rin", "neutral.png", 0.47, 0.40, 0.90),
    "len_cara": ("len", "timido.png", 0.50, 0.38, 0.75),
    "meiko_cara": ("meiko", "timido.png", 0.50, 0.33, 0.78),
    "adachirei_cara": ("adachirei", "feliz.png", 0.50, 0.40, 0.95),
    "ruko_cara": ("ruko", "feliz.png", 0.50, 0.32, 0.62),
    **{f"{lid}_cara": v for lid, v in pa.MOTOR.items()},
}
COMPARTIDAS = {"anon_cara": "anon", "kanon_cara": "kanon"}
CIRCULO = {"donramon_cara": "donramon", "godzilla_cara": "godzilla", "shaula_cara": "shaula", "mango_cara": "mango", "meowl_cara": "meowl"}


def from_motor(folder, name, cx, cy, side):
    return fit(pa.square(load(folder, name), cx, cy, side))


def from_shared(lid):
    name, x, y, side = pa.COMPARTIDAS[lid]
    img = Image.open(os.path.join(pa.FUENTES, name)).convert("RGBA")
    face = Image.new("RGBA", (side, side))
    left, top = x - side // 2, y - side // 2
    face.alpha_composite(img.crop((max(0, left), max(0, top), left + side, top + side)), (max(0, -left), max(0, -top)))
    return circle(face)  # la ilustración trae fondo


def circle(img):
    """Imagen con fondo propio: círculo con un borde fino claro (así se lee como cara sobre el fondo de Discord)."""
    big = SIZE * 4
    img = img.convert("RGBA").resize((big, big), Image.LANCZOS)
    mask = Image.new("L", (big, big))
    ImageDraw.Draw(mask).ellipse((6, 6, big - 7, big - 7), fill=255)
    out = Image.new("RGBA", (big, big))
    out.paste(img, (0, 0), mask)
    ImageDraw.Draw(out).ellipse((6, 6, big - 7, big - 7), outline=(255, 255, 255, 230), width=10)
    return out.resize((SIZE, SIZE), Image.LANCZOS)


def pina():
    original = pa.framed
    pa.framed = lambda face, color: face  # el dibujo sin el degradado de fondo
    try:
        face = pa.pina("#f6be32")
    finally:
        pa.framed = original
    return fit(face.crop(face.getbbox()))


def main():
    os.makedirs(DEST, exist_ok=True)
    items = []
    for name, args in MOTOR.items():
        items.append((name, from_motor(*args)))
    for name, lid in COMPARTIDAS.items():
        items.append((name, from_shared(lid)))
    for name, lid in CIRCULO.items():
        items.append((name, circle(Image.open(os.path.join(LUCHADORES, f"{lid}.png")))))
    items.append(("pina_cara", pina()))
    for name, img in items:
        path = os.path.join(DEST, f"{name}.png")
        img.save(path, optimize=True)
        if os.path.getsize(path) > 256 * 1024:
            raise SystemExit(f"carreras/{name}.png pesa más de 256 KB (límite de Discord para emojis)")
    preview(items)
    manifest_path = os.path.join(OUT, "packs.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    manifest["carreras"] = sorted(f"{n}.png" for n, _ in items)
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"ok carreras: {len(items)} emojis")


def preview(items):
    """Hoja grande con nombres y, abajo, una fila de pista como se vería en la carrera (tamaño real de Discord)."""
    cell, cols = 200, 6
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell + 70), (49, 51, 56, 255))
    d = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * cell
        sheet.alpha_composite(img.resize((150, 150), Image.LANCZOS), (x + 25, y + 8))
        sheet.alpha_composite(img.resize((32, 32), Image.LANCZOS), (x + 8, y + 160))
        d.text((x + 46, y + 170), f":{name}:", fill="white")
    y = rows * cell + 19
    for i, (_, img) in enumerate(items):
        sheet.alpha_composite(img.resize((32, 32), Image.LANCZOS), (12 + i * 40, y))
    sheet.convert("RGB").save(os.path.join(DEST, "00_vista_previa.png"))


if __name__ == "__main__":
    main()
