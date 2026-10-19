"""Stickers del servidor: pack gratis (todos los Papus) y pack de pago, desde los avatares del motor (solo lectura).
Estilo sticker: la Vocaloid recortada con borde blanco y una frase suya abajo. Discord pide PNG de 320x320 y < 512 KB.
Salida: assets/stickers/muestra/<pack>/<nombre>.png y 00_vista_previa.png (todas juntas, para revisar).
Uso: python scripts/make_stickers.py   (ENGINE_DIR por defecto ../Proyecto1)
Para cambiar un sticker, editar PACKS: personaje(s), archivo del motor, cuánto del cuerpo se ve (1 = entero) y la frase."""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "stickers", "muestra")
SIZE = 320
FONT = "C:/Windows/Fonts/ariblk.ttf"

# nombre: ([(personaje, archivo), ...], parte visible desde arriba, frase). Con encuadre (personaje, archivo,
# (centro x, centro y, lado)): solo las caras, de a dos lado a lado o de a tres en triángulo.
PACKS = {
    "gratis": {
        "teto_baguette": ([("teto", "riendo_3.png")], 1.0, "una más y ya"),
        "miku_que": ([("miku", "shocked_2.png")], 0.60, "¡¿QUÉ?!"),
        "luka_exactly": ([("luka", "presumido.png")], 0.60, "Exactly."),
        "neru_ok": ([("neru", "neutral_2.png")], 0.62, "…ok"),
        # Las dos derivadas de Miku que nacieron de los fans, haciendo la paz.
        "haku_neru": ([("haku", "feliz.png", (0.5, 0.45, 0.85)), ("neru", "r3d_feliz.png", (0.5, 0.42, 0.85))], 1.0, "LAS DERIVADAS"),
    },
    "pago": {
        # Con encuadre (centro x, centro y, lado): solo las caras, en triángulo (los mismos encuadres de los emojis).
        "triple_baka": ([("miku", "feliz_11.png", (0.5, 0.40, 0.80)), ("teto", "riendo.png", (0.5, 0.30, 0.60)), ("neru", "r3d_riendo.png", (0.5, 0.40, 0.75))], 1.0, "TRIPLE BAKA"),
        "teto_mi_pan": ([("teto", "shocked.png")], 1.0, "¡¿y mi baguette?!"),
        "gumi_me_apunto": ([("gumi", "emocionado.png")], 0.62, "¡yo me apunto!"),
        "gakupo_honor": ([("gakupo", "maduro_katana.png")], 0.62, "por mi honor"),
        "haku_perdon": ([("haku", "timido.png")], 0.62, "perdón…"),
        "kaito_helado": ([("kaito", "triste.png")], 0.62, "¿y mi helado?"),
    },
}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def load(char, name):
    path = os.path.join(ENGINE, "assets", "brand", "stickers", name) if char == "brand" else os.path.join(ENGINE, "assets", "characters", char, name)
    img = Image.open(path).convert("RGBA")
    # Sin pixeles sueltos (el borde blanco los convertiria en puntitos): se quitan las manchas de menos de ~5 px.
    alpha = img.split()[3]
    solid = alpha.point(lambda a: 255 if a > 24 else 0).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(7))
    img.putalpha(Image.composite(alpha, Image.new("L", img.size, 0), solid))
    box = img.getbbox()
    return img.crop(box) if box else img


def bust(img, part):
    """Parte de arriba del cuerpo (cara y torso): un sticker se lee mejor de cerca."""
    if part >= 1:
        return img
    return img.crop((0, 0, img.width, max(1, int(img.height * part))))


def square(img, cx, cy, side):
    """Recorte cuadrado de la cara (fracciones del contenido visible), como en scripts/make_emojis.py."""
    w, h = img.size
    s = int(min(w, h) * side)
    left = max(0, min(w - s, int(cx * w - s / 2)))
    top = max(0, min(h - s, int(cy * h - s / 2)))
    return img.crop((left, top, left + s, top + s))


# Baguette dibujada encima de la imagen: (x, y de la punta en la boca, ángulo, largo) en fracciones de la imagen.
BAGUETTES = {"teto_baguette": (0.49, 0.535, -22, 0.8)}


def baguette(length):
    """Baguette dorada con sus cortes, como la de la insignia de Ko-fi (sin texto)."""
    h = int(length * 0.22)
    img = Image.new("RGBA", (length, h))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, length - 1, h - 1), radius=h // 2, fill=(122, 66, 22))
    d.rounded_rectangle((5, 5, length - 6, h - 6), radius=(h - 10) // 2, fill=(214, 140, 58))
    d.rounded_rectangle((10, 8, length - 12, h // 2), radius=h // 4, fill=(236, 172, 84))
    for i in range(5):
        x = int(length * (0.16 + i * 0.16))
        d.line((x, int(h * 0.30), x + int(h * 0.55), int(h * 0.62)), fill=(250, 224, 170), width=max(3, h // 9))
    return img


def with_baguette(img, spec):
    mx, my, angle, frac = spec
    b = baguette(int(img.width * frac)).rotate(angle, expand=True, resample=Image.BICUBIC)
    out = Image.new("RGBA", (img.width + b.width, img.height + b.height // 2))
    out.alpha_composite(img)
    # La punta izquierda de la baguette queda en la boca.
    rad = __import__("math").radians(angle)
    tip_dx = int(b.width / 2 - __import__("math").cos(rad) * b.width / 2 * 0.92)
    tip_dy = int(b.height / 2 + __import__("math").sin(rad) * b.height / 2 * 0.92)
    out.alpha_composite(b, (max(0, int(img.width * mx) - tip_dx), max(0, int(img.height * my) - tip_dy)))
    box = out.getbbox()
    return out.crop(box) if box else out


def pair(imgs):
    """Dos caras lado a lado, la segunda un poco más abajo y superpuesta."""
    n = 400
    a, b = [i.resize((n, n), Image.LANCZOS) for i in imgs]
    canvas = Image.new("RGBA", (int(n * 1.8), int(n * 1.12)))
    canvas.alpha_composite(a, (0, 0))
    canvas.alpha_composite(b, (canvas.width - n, canvas.height - n))
    return canvas


def triangle(imgs):
    """Tres caras: la primera arriba al centro, las otras dos abajo, un poco superpuestas."""
    n = 400
    a, b, c = [i.resize((n, n), Image.LANCZOS) for i in imgs]
    canvas = Image.new("RGBA", (int(n * 1.8), int(n * 1.55)))
    canvas.alpha_composite(a, ((canvas.width - n) // 2, 0))
    canvas.alpha_composite(b, (0, canvas.height - n))
    canvas.alpha_composite(c, (canvas.width - n, canvas.height - n))
    return canvas


def group(imgs):
    """Varias Vocaloids lado a lado, un poco superpuestas, alineadas abajo."""
    h = max(i.height for i in imgs)
    imgs = [i.resize((int(i.width * h / i.height), h), Image.LANCZOS) for i in imgs]
    step = [int(i.width * 0.5) for i in imgs]
    canvas = Image.new("RGBA", (sum(step[:-1]) + imgs[-1].width, h))
    x = 0
    for i, s in zip(imgs, step):
        canvas.alpha_composite(i, (x, h - i.height))
        x += s
    return canvas


def die_cut(img, border=9):
    """Borde blanco alrededor de la figura (como sticker recortado) y una sombra suave."""
    pad = border * 2
    base = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2))
    base.alpha_composite(img, (pad, pad))
    alpha = base.split()[3]
    grown = alpha
    for _ in range(max(1, border // 4)):
        grown = grown.filter(ImageFilter.MaxFilter(9))
    grown = grown.filter(ImageFilter.GaussianBlur(1)).point(lambda a: 255 if a > 40 else 0)
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow.putalpha(grown.filter(ImageFilter.GaussianBlur(5)).point(lambda a: int(a * 0.35)))
    white = Image.new("RGBA", base.size, (255, 255, 255, 0))
    white.putalpha(grown)
    out = Image.new("RGBA", base.size)
    out.alpha_composite(shadow, (0, 3))
    out.alpha_composite(white)
    out.alpha_composite(base)
    return out


def caption(canvas, text, color):
    if not text:
        return
    draw = ImageDraw.Draw(canvas)
    size = 46
    while size > 18:
        font = ImageFont.truetype(FONT, size)
        l, t, r, b = draw.textbbox((0, 0), text, font=font, stroke_width=6)
        if r - l <= SIZE - 16:
            break
        size -= 2
    x = (SIZE - (r - l)) // 2 - l
    y = SIZE - (b - t) - 10 - t
    draw.text((x, y), text, font=font, fill="white", stroke_width=6, stroke_fill=color)


def make(pack, name, spec, colors):
    parts, part, text = spec
    if all(len(p) == 3 for p in parts):
        faces = [square(load(p[0], p[1]), *p[2]) for p in parts]
        fig = die_cut(pair(faces) if len(faces) == 2 else triangle(faces))
    elif name in BAGUETTES:
        fig = die_cut(with_baguette(bust(load(parts[0][0], parts[0][1]), part), BAGUETTES[name]))
    else:
        imgs = [bust(load(p[0], p[1]), part) for p in parts]
        fig = die_cut(group(imgs) if len(imgs) > 1 else imgs[0])
    room = SIZE - (62 if text else 12)
    scale = min((SIZE - 12) / fig.width, room / fig.height)
    fig = fig.resize((max(1, int(fig.width * scale)), max(1, int(fig.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE))
    canvas.alpha_composite(fig, ((SIZE - fig.width) // 2, max(0, room - fig.height) + 4))
    first = "teto" if len(parts) == 3 else parts[0][0]
    caption(canvas, text, colors.get(first, (40, 40, 40)))
    path = os.path.join(OUT, pack, f"{name}.png")
    canvas.save(path, optimize=True)
    kb = os.path.getsize(path) / 1024
    if kb > 512:
        raise SystemExit(f"{pack}/{name}.png pesa {kb:.0f} KB (Discord acepta hasta 512 KB)")
    return canvas


def preview(pack, stickers):
    cols = 3
    rows = (len(stickers) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * SIZE, rows * SIZE), (54, 57, 63, 255))  # fondo oscuro de Discord
    for i, s in enumerate(stickers):
        sheet.alpha_composite(s, ((i % cols) * SIZE, (i // cols) * SIZE))
    sheet.convert("RGB").save(os.path.join(OUT, pack, "00_vista_previa.png"))


def main():
    chars = json.load(open(os.path.join(ENGINE, "config/characters.json"), encoding="utf-8"))["characters"]
    # Color del borde del texto: el tono oscuro de la paleta del personaje (o su color, oscurecido).
    colors = {}
    for cid, c in chars.items():
        pal = c.get("palette")
        colors[cid] = hex_rgb(pal[0]) if pal else tuple(int(v * 0.35) for v in hex_rgb(c["subtitleColor"]))
    for pack, specs in PACKS.items():
        os.makedirs(os.path.join(OUT, pack), exist_ok=True)
        made = [make(pack, name, spec, colors) for name, spec in specs.items()]
        preview(pack, made)
        print(f"ok {pack}: {len(made)} stickers")


if __name__ == "__main__":
    main()
