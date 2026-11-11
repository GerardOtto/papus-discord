"""Avatares de los luchadores invitados del 1vs1 (PLAN §3.7): assets/peleas/luchadores/<id>.png (512x512).
Los Vocaloids del servidor usan su avatar de bot (assets/bots/<id>_avatar.png); aqui van los que no son bots:
- personajes del motor (imagenes de Proyecto1/assets/characters, solo lectura): cara recortada sobre su paleta;
- imagen propia en assets/peleas/fuentes/<id>.png (o .jpg/.webp) para los invitados especiales sin imagen en el motor
  (Don Ramon, Godzilla, Shaula): se centra el contenido visible en un cuadrado;
- la Pina (la fruta), dibujada aqui mismo.
Uso: python scripts/peleas_avatares.py [ids]   (--hoja: ademas, hoja de contacto en data/peleas-avatares.png)
Un luchador sin avatar no pelea (el bot lo salta), asi que se puede configurar antes de tener su imagen."""
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_avatars import ENGINE, ROOT, hex_rgb, radial, visible, with_glow  # noqa: E402

OUT = os.path.join(ROOT, "assets", "peleas", "luchadores")
FUENTES = os.path.join(ROOT, "assets", "peleas", "fuentes")
SIZE = 512

# Personajes del motor: carpeta, imagen y recorte cuadrado (cx, cy, lado) en fracciones del contenido visible.
MOTOR = {
    "ted": ("ted", "neutral.png", 0.470, 0.170, 0.45),
    "nero": ("nero", "neutral.png", 0.500, 0.420, 0.85),
    "lily": ("lily", "feliz.png", 0.300, 0.080, 0.30),
    "defoko": ("defoko", "feliz.png", 0.450, 0.380, 0.80),
    "kafu": ("kafu", "feliz.png", 0.600, 0.470, 0.78),
    "momo": ("momo", "feliz.png", 0.420, 0.320, 0.78),
}


# Recorte de una imagen compartida (en pixeles de la imagen original, sin recortar lo transparente): centro (x, y) y
# lado. Anon y Kanon salen de la misma ilustracion (eleccion de GyroP, 8 nov. 2026) con el MISMO lado, para que las dos
# caras queden del mismo tamaño en sus avatares.
COMPARTIDAS = {
    "anon": ("anon-kanon.webp", 401, 150, 300),
    "kanon": ("anon-kanon.webp", 645, 160, 300),
}


def from_shared(lid, color):
    name, x, y, side = COMPARTIDAS[lid]
    img = Image.open(os.path.join(FUENTES, name)).convert("RGBA")
    face = Image.new("RGBA", (side, side))
    left, top = x - side // 2, y - side // 2
    face.alpha_composite(img.crop((max(0, left), max(0, top), left + side, top + side)), (max(0, -left), max(0, -top)))
    return framed(face, color)


def config():
    return json.load(open(os.path.join(ROOT, "config", "peleas.json"), encoding="utf-8"))["luchadores"]


def palette(color):
    mid = hex_rgb(color)
    dark = tuple(int(v * 0.22) for v in mid)
    light = tuple(int(v + (255 - v) * 0.7) for v in mid)
    return dark, mid, light


def framed(face, color):
    """Cara sobre el degradado del color del luchador, con su brillo (como los avatares de los bots)."""
    dark, mid, light = palette(color)
    inner = tuple((a + b) // 2 for a, b in zip(mid, light))
    bg = radial((SIZE, SIZE), inner, dark).convert("RGBA")
    bg.alpha_composite(with_glow(face.resize((SIZE, SIZE), Image.LANCZOS), mid, 10))
    return bg.convert("RGB")


def square(img, cx, cy, side):
    img = visible(img)
    w, h = img.size
    s = int(min(w, h) * side) if side < 1 else max(w, h)
    left = int(cx * w - s / 2)
    top = int(cy * h - s / 2)
    out = Image.new("RGBA", (s, s))
    out.alpha_composite(img.crop((max(0, left), max(0, top), min(w, left + s), min(h, top + s))), (max(0, -left), max(0, -top)))
    return out


def from_engine(lid, color):
    folder, name, cx, cy, side = MOTOR[lid]
    img = Image.open(os.path.join(ENGINE, "assets/characters", folder, name)).convert("RGBA")
    return framed(square(img, cx, cy, side), color)


def from_source(lid, color):
    for ext in ("png", "webp", "jpg", "jpeg"):
        p = os.path.join(FUENTES, f"{lid}.{ext}")
        if os.path.exists(p):
            img = Image.open(p).convert("RGBA")
            # Con fondo propio (foto, captura): solo se recorta al cuadrado del centro; con transparencia, va sobre su color.
            if img.getchannel("A").getextrema()[0] == 255:
                w, h = img.size
                s = min(w, h)
                return img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((SIZE, SIZE), Image.LANCZOS).convert("RGB")
            return framed(square(img, 0.5, 0.5, 1.05), color)
    return None


def pina(color):
    """La Pina, la fruta: cuerpo dorado con rombos, corona de hojas, carita kawaii y mejillas."""
    S = SIZE * 2  # se dibuja al doble y se reduce (bordes suaves)
    img = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(img)
    # Corona: hojas en abanico.
    leaf, leaf_dark = (88, 170, 72, 255), (52, 120, 50, 255)
    base = (S * 0.5, S * 0.40)
    for k, ang in enumerate([-62, -40, -20, 0, 20, 40, 62]):
        a = math.radians(ang - 90)
        length = S * (0.30 if ang == 0 else 0.26 if abs(ang) == 20 else 0.21 if abs(ang) == 40 else 0.15)
        tip = (base[0] + math.cos(a) * length, base[1] + math.sin(a) * length)
        perp = (math.cos(a + math.pi / 2) * S * 0.035, math.sin(a + math.pi / 2) * S * 0.035)
        d.polygon([(base[0] - perp[0], base[1] - perp[1]), tip, (base[0] + perp[0], base[1] + perp[1])], fill=leaf if k % 2 else leaf_dark)
    # Cuerpo.
    box = (S * 0.24, S * 0.34, S * 0.76, S * 0.95)
    body = Image.new("L", (S, S))
    ImageDraw.Draw(body).ellipse(box, fill=255)
    gold = Image.new("RGBA", (S, S), (246, 190, 50, 255))
    img.paste(gold, (0, 0), body)
    # Rombos (lineas cruzadas) solo dentro del cuerpo.
    lines = Image.new("RGBA", (S, S))
    ld = ImageDraw.Draw(lines)
    step = S * 0.075
    for i in range(-20, 40):
        x0 = S * 0.1 + i * step
        ld.line([(x0, S * 0.3), (x0 + S * 0.7, S * 1.0)], fill=(200, 130, 30, 255), width=int(S * 0.012))
        ld.line([(x0 + S * 0.7, S * 0.3), (x0, S * 1.0)], fill=(200, 130, 30, 255), width=int(S * 0.012))
    mask = body.point(lambda v: v)
    img.paste(lines, (0, 0), Image.composite(lines.getchannel("A"), Image.new("L", (S, S)), mask))
    # Brillo.
    d.ellipse((S * 0.33, S * 0.44, S * 0.42, S * 0.58), fill=(255, 236, 160, 150))
    # Carita (en un panel claro para que se lea sobre los rombos).
    d.ellipse((S * 0.36, S * 0.56, S * 0.64, S * 0.80), fill=(255, 214, 110, 255))
    for ex in (0.44, 0.56):
        d.ellipse((S * (ex - 0.025), S * 0.62, S * (ex + 0.025), S * 0.68), fill=(50, 30, 20, 255))
        d.ellipse((S * (ex - 0.012), S * 0.625, S * (ex + 0.002), S * 0.64), fill=(255, 255, 255, 255))
    d.arc((S * 0.47, S * 0.66, S * 0.53, S * 0.72), 20, 160, fill=(50, 30, 20, 255), width=int(S * 0.008))
    for cx in (0.40, 0.60):
        d.ellipse((S * (cx - 0.03), S * 0.69, S * (cx + 0.03), S * 0.72), fill=(255, 120, 130, 170))
    face = img.resize((SIZE, SIZE), Image.LANCZOS)
    return framed(face, color)


def main():
    cfg = config()
    os.makedirs(OUT, exist_ok=True)
    ids = [a for a in sys.argv[1:] if not a.startswith("--")] or [k for k, v in cfg.items() if v.get("nombre")]
    made = []
    for lid in ids:
        l = cfg[lid]
        color = l["color"]
        if lid == "pina":
            out = pina(color)
        elif lid in COMPARTIDAS:
            out = from_shared(lid, color)
        elif lid in MOTOR:
            out = from_engine(lid, color)
        else:
            out = from_source(lid, color)
        if out is None:
            print(f"-- {lid}: falta su imagen en assets/peleas/fuentes/{lid}.png (no pelea hasta tenerla)")
            continue
        out.save(os.path.join(OUT, f"{lid}.png"), optimize=True)
        made.append(lid)
        print(f"ok {lid}")
    if "--hoja" in sys.argv and made:
        cols = 6
        t = 160
        sheet = Image.new("RGB", (cols * t, math.ceil(len(made) / cols) * t), (20, 20, 20))
        for i, lid in enumerate(made):
            sheet.paste(Image.open(os.path.join(OUT, f"{lid}.png")).resize((t, t)), ((i % cols) * t, (i // cols) * t))
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        sheet.save(os.path.join(ROOT, "data", "peleas-avatares.png"))


if __name__ == "__main__":
    main()
