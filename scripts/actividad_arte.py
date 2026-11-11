"""Arte de la Actividad de Discord (trivia multijugador de Teto, PLAN §3.4), con la marca del canal (TetoCiencia, kit
del motor en ../Proyecto1/assets/brand: fondo rojo vino a violeta marino con cuadricula, destellos, Fredoka con
contorno marino, segunda linea rosa, franja azul-turquesa-rojo-amarillo-rosa y el logo con ondas) y los renders "nerd"
de los personajes del motor (solo lectura).
  python scripts/actividad_arte.py
En assets/actividad/ estan la portada (Cover Art), el fondo (Embedded Background), ambos 1920x1080, y el icono
(1024x1024) que eligio GyroP; este script deja
  web/          lo que usa la pagina (la portada en chico, Teto reaccionando, logo, sticker y fuentes); npm run actividad lo copia
  (con --propuesta, ademas, propuestas automaticas de portada, fondo e icono en assets/actividad/propuesta/)
Texto centrado por su caja real (bbox) y sin salirse (memoria: imagenes-texto-centrado).
"""
import math
import os
import sys
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ENGINE = Path(os.environ.get("ENGINE_DIR", ROOT.parent / "Proyecto1"))
CHARS = ENGINE / "assets" / "characters"
BRAND = ENGINE / "assets" / "brand"
FONTS = ENGINE / "assets" / "fonts"
OUT = ROOT / "assets" / "actividad"
WEB = OUT / "web"
FREDOKA = str(FONTS / "fredoka-latin-700-normal.woff2")
FREDOKA_SB = str(FONTS / "fredoka-latin-600-normal.woff2")
W, H = 1920, 1080
SAFE_W = round(H * 13 / 11)  # recorte 13:11 del centro (vista de 2 por fila del estante de Actividades)
SAFE_X = (W - SAFE_W) // 2

# Paleta de las plantillas del canal (muestreada de cierre_carrusel y plantilla_historia_teto_presenta).
VINO = (102, 35, 56)
MARINO = (44, 35, 71)
ROJIZO = (117, 45, 61)
CONTORNO = (17, 24, 51)
ROSA = (226, 133, 178)
AMARILLO = (246, 199, 68)
TURQUESA = (57, 197, 187)
FRANJA = [(61, 123, 255), (57, 197, 187), (229, 50, 63), (246, 199, 68), (226, 133, 178)]


def fondo_marca(w: int, h: int) -> Image.Image:
    """Degradado de las plantillas: vino arriba a la izquierda, violeta marino al centro, rojizo abajo a la derecha."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            a = max(0.0, 1 - math.hypot(x / w, y / h) / 0.9)
            b = max(0.0, 1 - math.hypot(1 - x / w, 1 - y / h) / 0.8) * 0.8
            px[x, y] = tuple(max(0, min(255, int(MARINO[i] * (1 - a - b) + VINO[i] * a + ROJIZO[i] * b))) for i in range(3))
    img = img.convert("RGBA")
    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(grid)
    step = max(40, w // 20)
    for x in range(0, w, step):
        d.line((x, 0, x, h), fill=(255, 255, 255, 16), width=2)
    for y in range(0, h, step):
        d.line((0, y, w, y), fill=(255, 255, 255, 16), width=2)
    img.alpha_composite(grid)
    return img


def franja(img: Image.Image) -> None:
    """Franja de colores al pie (azul, turquesa, rojo, amarillo y rosa), encima de todo."""
    w, h = img.size
    fh = max(8, h // 90)
    seg = w / len(FRANJA)
    d = ImageDraw.Draw(img)
    for k, col in enumerate(FRANJA):
        d.rectangle((round(k * seg), h - fh, round((k + 1) * seg), h), fill=col)


def destello(img: Image.Image, x: int, y: int, r: int, color) -> None:
    """Estrella de 4 puntas como las de las plantillas, con brillo."""
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    k = r * 0.22
    ImageDraw.Draw(capa).polygon([(x, y - r), (x + k, y - k), (x + r, y), (x + k, y + k), (x, y + r), (x - k, y + k), (x - r, y), (x - k, y - k)], fill=color + (255,))
    img.alpha_composite(capa.filter(ImageFilter.GaussianBlur(r * 0.6)))
    img.alpha_composite(capa)


def destellos(img: Image.Image, puntos) -> None:
    for fx, fy, r, col in puntos:
        destello(img, int(fx * img.width), int(fy * img.height), r, col)


def abajo(img: Image.Image, path: str, alto: int, x: int) -> None:
    """Personaje apoyado en el borde de abajo (los renders vienen cortados por abajo: asi no se nota)."""
    p = personaje(path, alto)
    sombra(img, p, x, img.height - p.height)


def personaje(path: str, alto: int) -> Image.Image:
    im = Image.open(CHARS / path).convert("RGBA")
    im = im.crop(im.getbbox())
    return im.resize((round(im.width * alto / im.height), alto), Image.LANCZOS)


def sombra(img: Image.Image, im: Image.Image, x: int, y: int) -> None:
    """Pega al personaje con una sombra suave detras (como en las plantillas)."""
    s = Image.new("RGBA", im.size, (8, 6, 20, 0))
    s.putalpha(im.getchannel("A").point(lambda a: 140 if a > 10 else 0))
    pad = 40
    big = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    big.paste(s, (pad, pad), s)
    img.alpha_composite(big.filter(ImageFilter.GaussianBlur(16)), (x - pad + 10, y - pad + 14))
    img.alpha_composite(im, (x, y))


def ajustar(path: str, texto: str, ancho: int, size: int, stroke: int = 0) -> ImageFont.FreeTypeFont:
    """La fuente mas grande (hasta `size`) con la que el texto cabe en `ancho`."""
    while size > 10:
        f = ImageFont.truetype(path, size)
        l, _, r, _ = f.getbbox(texto, stroke_width=stroke)
        if r - l <= ancho:
            return f
        size -= 4
    return ImageFont.truetype(path, size)


def titulo(img: Image.Image, texto: str, x: int, cy: int, font, fill, stroke: int, centro: bool = False) -> None:
    """Texto estilo plantilla: relleno, contorno marino grueso y sombra dura abajo. x = izquierda (o centro si `centro`)."""
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), texto, font=font, stroke_width=stroke)
    ox = x - (l + r) / 2 if centro else x - l
    oy = cy - (t + b) / 2
    if stroke:
        d.text((ox, oy + stroke * 0.7), texto, font=font, fill=CONTORNO, stroke_width=stroke, stroke_fill=CONTORNO)
    d.text((ox, oy), texto, font=font, fill=fill, stroke_width=stroke, stroke_fill=CONTORNO)


def tarjeta(img: Image.Image, texto: str, x: int, cy: int, font) -> None:
    """Tarjeta oscura translucida de esquinas redondas (como la de las plantillas). x = izquierda."""
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), texto, font=font)
    pw, ph = (r - l) + 64, (b - t) + 40
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(capa).rounded_rectangle((x, cy - ph / 2, x + pw, cy + ph / 2), radius=26, fill=(26, 18, 46, 215))
    img.alpha_composite(capa)
    ImageDraw.Draw(img).text((x + 32 - l, cy - (t + b) / 2), texto, font=font, fill=(255, 255, 255))


def logo(ancho: int) -> Image.Image:
    im = Image.open(BRAND / "kit" / "01 Logo" / "logo_con_ondas.png").convert("RGBA")
    im = im.crop(im.getbbox())
    return im.resize((ancho, round(im.height * ancho / im.width)), Image.LANCZOS)


def portada() -> Image.Image:
    img = fondo_marca(W, H)
    # Los otros nerds en los bordes (casi enteros fuera del recorte 13:11).
    for path, alto, x in (("miku/nerd_4.png", 620, -80), ("lukacasual/nerd.png", 470, 120), ("rin/nerd.png", 560, W - 330)):
        abajo(img, path, alto, x)
    destellos(img, [(0.2, 0.12, 26, (255, 255, 255)), (0.78, 0.1, 18, AMARILLO), (0.5, 0.06, 14, TURQUESA), (0.83, 0.42, 22, TURQUESA), (0.22, 0.86, 16, AMARILLO)])
    teto = personaje("teto/nerd.png", 760)
    sombra(img, teto, SAFE_X + SAFE_W - teto.width + 40, H - teto.height)
    izq, ancho = SAFE_X + 70, 640
    titulo(img, "Trivia", izq, 300, ajustar(FREDOKA, "Trivia", ancho, 230, 16), (255, 255, 255), 16)
    titulo(img, "Vocaloid", izq, 500, ajustar(FREDOKA, "Vocaloid", ancho, 200, 16), ROSA, 16)
    tarjeta(img, "Eliminatoria  ·  Cooperativo", izq, 680, ImageFont.truetype(FREDOKA_SB, 46))
    img.alpha_composite(logo(500), (izq, 830))
    franja(img)
    return img


def fondo() -> Image.Image:
    img = fondo_marca(W, H)
    for path, alto, x in (("miku/nerd_4.png", 700, -80), ("lukacasual/nerd.png", 600, 190), ("teto/nerd_3.png", 600, W - 520), ("rin/nerd.png", 560, W - 290)):
        abajo(img, path, alto, x)
    velo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(velo).ellipse((W // 2 - 700, -250, W // 2 + 700, H + 250), fill=(20, 14, 38, 170))
    img.alpha_composite(velo.filter(ImageFilter.GaussianBlur(110)))
    destellos(img, [(0.08, 0.12, 22, (255, 255, 255)), (0.92, 0.15, 18, AMARILLO), (0.95, 0.4, 14, TURQUESA), (0.04, 0.4, 16, AMARILLO)])
    franja(img)
    return img


def icono() -> Image.Image:
    s = 1024
    img = fondo_marca(s, s)
    destellos(img, [(0.2, 0.62, 30, (255, 255, 255)), (0.82, 0.2, 24, AMARILLO)])
    teto = personaje("teto/nerd_4.png", 860)
    sombra(img, teto, (s - teto.width) // 2 + 70, s - teto.height)
    # Insignia "?" tipo sticker del canal (blanco, sombra gris y azul de la franja), dentro del circulo.
    d = ImageDraw.Draw(img)
    cx, cy, r = 290, 290, 120
    d.ellipse((cx - r - 16, cy - r - 10, cx + r + 16, cy + r + 22), fill=(170, 170, 180))
    d.ellipse((cx - r - 14, cy - r - 14, cx + r + 14, cy + r + 14), fill=(255, 255, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=FRANJA[0])
    titulo(img, "?", cx, cy, ImageFont.truetype(FREDOKA, 220), (255, 255, 255), 0, centro=True)
    return img


def web() -> None:
    """Piezas livianas para la pagina: portada chica, Teto reaccionando, logo, sticker de dato curioso y fuentes (OFL)."""
    WEB.mkdir(parents=True, exist_ok=True)
    Image.open(OUT / "portada.png").convert("RGB").resize((960, 540), Image.LANCZOS).save(WEB / "portada.webp", quality=82)
    for nombre, path in (("teto-nerd", "teto/nerd.png"), ("teto-riendo", "teto/riendo.png"), ("teto-shock", "teto/sorprendido_2.png"), ("teto-presumida", "teto/presumido.png")):
        im = Image.open(CHARS / path).convert("RGBA")
        im = im.crop(im.getbbox())
        im.thumbnail((320, 320), Image.LANCZOS)
        im.save(WEB / f"{nombre}.webp", quality=85)
    logo(520).save(WEB / "logo.webp", quality=90)
    st = Image.open(BRAND / "stickers" / "sticker_dato_curioso.png").convert("RGBA")
    st = st.crop(st.getbbox())
    st.thumbnail((360, 120), Image.LANCZOS)
    st.save(WEB / "dato.webp", quality=90)
    for f in ("fredoka-latin-600-normal.woff2", "fredoka-latin-700-normal.woff2", "inter-latin-400-normal.woff2", "inter-latin-600-normal.woff2", "inter-latin-700-normal.woff2", "OFL-Fredoka.txt", "OFL-Inter.txt"):
        shutil.copyfile(FONTS / f, WEB / f)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    # Desde el 8 nov. 2026 la portada y el icono del Developer Portal son los que eligio GyroP (portada v5: Miku V6 y
    # Teto SV en ilustracion 2D; icono hecho por el en Canva): estan en assets/actividad/ y no se regeneran. Con
    # --propuesta se dibujan las propuestas automaticas (portada, fondo e icono) en assets/actividad/propuesta/.
    if "--propuesta" in sys.argv:
        dest = OUT / "propuesta"
        dest.mkdir(exist_ok=True)
        for name, make in (("portada", portada), ("fondo", fondo), ("icono", icono)):
            im = make().convert("RGB")
            im.save(dest / f"{name}.png", optimize=True)
            print(f"ok assets/actividad/propuesta/{name}.png {im.size[0]}x{im.size[1]}")
    web()
    print("ok assets/actividad/web/ " + ", ".join(sorted(p.name for p in WEB.iterdir())))
