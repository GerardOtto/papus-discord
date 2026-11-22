"""Portada, fondo e icono del celular de Neru para el Developer Portal (PLAN §3.15).

Mismo lenguaje que las de la trivia multijugador (scripts/actividad_arte.py: titulo Fredoka con contorno marino, tarjeta
translucida, destellos de 4 puntas, logo de TetoCiencia y franja de colores), pero con los colores del tema de Neru
(negro y amarillo) y solo renders de Neru (no se mezclan con ilustraciones 2D). En el telefono, los iconos de la app.

  python scripts/celular_arte.py   ->  assets/celular/portada.png (1920x1080), fondo.png (1920x1080), icono.png (1024)
"""
import importlib.util
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("actividad_arte", ROOT / "scripts" / "actividad_arte.py")
A = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(A)  # type: ignore[union-attr]

OUT = ROOT / "assets" / "celular"
ICONOS = ROOT / "worker" / "celular" / "cliente" / "iconos"
W, H = A.W, A.H
NEGRO = (27, 29, 36)
PIZARRA = (44, 48, 59)
AMARILLO = (242, 194, 48)
CONTORNO = A.CONTORNO


def fondo_neru(w: int, h: int) -> Image.Image:
    """Negro de Neru con un brillo amarillo muy suave arriba a la izquierda y la cuadricula de las plantillas."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            a = max(0.0, 1 - math.hypot(x / w, y / h) / 0.95) * 0.32
            b = max(0.0, 1 - math.hypot(1 - x / w, 1 - y / h) / 0.9) * 0.55
            px[x, y] = tuple(int(NEGRO[i] * (1 - a - b) + (92, 74, 24)[i] * a + PIZARRA[i] * b) for i in range(3))
    img = img.convert("RGBA")
    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(grid)
    step = max(40, w // 20)
    for x in range(0, w, step):
        d.line((x, 0, x, h), fill=(255, 255, 255, 14), width=2)
    for y in range(0, h, step):
        d.line((0, y, w, y), fill=(255, 255, 255, 14), width=2)
    img.alpha_composite(grid)
    return img


def icono_png(nombre: str, lado: int) -> Image.Image:
    """Icono de la app (los kawaii de la tienda o los SVG ya pasados a PNG en assets/celular/iconos/)."""
    tienda = ROOT / "assets" / "tienda" / "iconos" / f"{nombre}.png"
    path = tienda if tienda.exists() else OUT / "iconos" / f"{nombre}.png"
    return Image.open(path).convert("RGBA").resize((lado, lado), Image.LANCZOS)


def telefono(alto: int) -> Image.Image:
    """El celular de Neru: marco negro, NeruOS arriba y la cuadricula de apps en pastel."""
    ancho = round(alto * 0.5)
    pad = 60
    im = Image.new("RGBA", (ancho + pad * 2, alto + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = pad, pad, pad + ancho, pad + alto
    r = round(ancho * 0.16)
    d.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=(12, 12, 16), outline=AMARILLO, width=8)
    m = round(ancho * 0.05)
    d.rounded_rectangle((x0 + m, y0 + m, x1 - m, y1 - m), radius=r - m, fill=NEGRO)
    # muesca
    d.rounded_rectangle((x0 + ancho * 0.36, y0 + m + 10, x1 - ancho * 0.36, y0 + m + 34), radius=12, fill=(12, 12, 16))
    f = ImageFont.truetype(A.FREDOKA, round(ancho * 0.085))
    d.text((x0 + m + 26, y0 + m + 62), "NeruOS", font=f, fill=AMARILLO)
    d.text((x1 - m - 26, y0 + m + 64), "3 %", font=ImageFont.truetype(A.FREDOKA_SB, round(ancho * 0.06)), fill=(255, 122, 156), anchor="ra")
    # tarjeta del Papu (franja)
    ty = y0 + m + 130
    d.rounded_rectangle((x0 + m + 22, ty, x1 - m - 22, ty + round(ancho * 0.26)), radius=16, fill=(22, 50, 56))
    d.ellipse((x0 + m + 40, ty + 16, x0 + m + 40 + round(ancho * 0.18), ty + 16 + round(ancho * 0.18)), fill=(57, 197, 187), outline=AMARILLO, width=5)
    d.rounded_rectangle((x0 + m + 70 + round(ancho * 0.18), ty + 30, x1 - m - 60, ty + 52), radius=10, fill=(244, 241, 230))
    d.rounded_rectangle((x0 + m + 70 + round(ancho * 0.18), ty + 70, x1 - m - 110, ty + 90), radius=10, fill=AMARILLO)
    # apps
    nombres = ["trivia", "vocaloidle", "silueta", "ruleta", "tarjeta", "tienda", "mochila", "comercio"]
    tiles = [(255, 225, 231), (221, 245, 230), (231, 226, 255), (255, 240, 201), (221, 242, 238), (255, 230, 238), (236, 231, 255), (255, 240, 217)]
    cols = 4
    gx0 = x0 + m + 22
    cel = (ancho - 2 * m - 44) / cols
    lado = round(cel * 0.82)
    gy = ty + round(ancho * 0.26) + 46
    for k, (n, t) in enumerate(zip(nombres, tiles)):
        cx = gx0 + (k % cols) * cel + (cel - lado) / 2
        cy = gy + (k // cols) * (lado + 34)
        d.rounded_rectangle((cx, cy, cx + lado, cy + lado), radius=round(lado * 0.3), fill=t)
        ic = icono_png(n, round(lado * 0.78))
        im.alpha_composite(ic, (round(cx + (lado - ic.width) / 2), round(cy + (lado - ic.height) / 2)))
    # burbuja de notificacion
    ny = gy + 2 * (lado + 34) + 20
    d.rounded_rectangle((x0 + m + 22, ny, x1 - m - 22, ny + 70), radius=18, fill=(44, 48, 59))
    d.rounded_rectangle((x0 + m + 38, ny + 14, x0 + m + 80, ny + 56), radius=10, fill=(255, 240, 217))
    d.rounded_rectangle((x0 + m + 96, ny + 18, x1 - m - 60, ny + 32), radius=7, fill=(244, 241, 230))
    d.rounded_rectangle((x0 + m + 96, ny + 42, x1 - m - 120, ny + 54), radius=6, fill=(169, 173, 186))
    return im


def sombra_suave(img: Image.Image, im: Image.Image, x: int, y: int) -> None:
    s = Image.new("RGBA", im.size, (0, 0, 0, 0))
    s.putalpha(im.getchannel("A").point(lambda a: 150 if a > 10 else 0))
    big = Image.new("RGBA", (im.width + 80, im.height + 80), (0, 0, 0, 0))
    big.paste(s, (40, 40), s)
    img.alpha_composite(big.filter(ImageFilter.GaussianBlur(20)), (x - 40 + 14, y - 40 + 20))
    img.alpha_composite(im, (x, y))


def portada() -> Image.Image:
    img = fondo_neru(W, H)
    A.destellos(img, [(0.24, 0.1, 26, (255, 255, 255)), (0.5, 0.06, 16, AMARILLO), (0.86, 0.12, 22, AMARILLO), (0.66, 0.48, 18, A.TURQUESA), (0.2, 0.88, 16, A.ROSA)])
    # Neru con su celular, a la derecha (dentro del recorte 13:11 del estante de Actividades).
    neru = A.personaje("neru/r3d_presumido_2.png", 1000)
    nx = A.SAFE_X + A.SAFE_W - neru.width + 540
    A.sombra(img, neru, nx, H - neru.height)
    # El telefono, inclinado, delante de Neru (como si lo mostrara), a la derecha del titulo.
    tel = telefono(600).rotate(-8, resample=Image.BICUBIC, expand=True)
    sombra_suave(img, tel, 790, (H - tel.height) // 2)
    izq, ancho = A.SAFE_X + 14, 560
    A.titulo(img, "El celular", izq, 230, A.ajustar(A.FREDOKA, "El celular", ancho, 170, 14), (255, 255, 255), 14)
    A.titulo(img, "de Neru", izq, 400, A.ajustar(A.FREDOKA, "de Neru", ancho, 170, 14), AMARILLO, 14)
    A.tarjeta(img, "Vocaloidle · Silueta · Trivia", izq, 570, ImageFont.truetype(A.FREDOKA_SB, 38))
    img.alpha_composite(A.logo(430), (izq, 800))
    A.franja(img)
    return img


def fondo() -> Image.Image:
    img = fondo_neru(W, H)
    for path, alto, x in (("neru/r3d_emocionado_4.png", 640, -60), ("neru/r3d_saludando.png", 620, W - 470)):
        A.abajo(img, path, alto, x)
    velo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(velo).ellipse((W // 2 - 700, -250, W // 2 + 700, H + 250), fill=(14, 14, 18, 170))
    img.alpha_composite(velo.filter(ImageFilter.GaussianBlur(110)))
    A.destellos(img, [(0.08, 0.12, 22, (255, 255, 255)), (0.92, 0.15, 18, AMARILLO), (0.95, 0.4, 14, A.TURQUESA), (0.04, 0.4, 16, AMARILLO)])
    A.franja(img)
    return img


def icono() -> Image.Image:
    s = 1024
    img = fondo_neru(s, s)
    A.destellos(img, [(0.2, 0.18, 34, A.ROSA), (0.83, 0.16, 30, AMARILLO), (0.16, 0.68, 30, A.TURQUESA), (0.72, 0.9, 30, (255, 255, 255))])
    neru = A.personaje("neru/nerd.png", 1260)
    A.sombra(img, neru, -150, -120)
    # Insignia del celular (como el "?" del icono de Teto): circulo amarillo con un telefono, dentro del circulo de Discord.
    d = ImageDraw.Draw(img)
    cx, cy, r = 848, 862, 96
    d.ellipse((cx - r - 16, cy - r - 10, cx + r + 16, cy + r + 22), fill=(170, 170, 180))
    d.ellipse((cx - r - 14, cy - r - 14, cx + r + 14, cy + r + 14), fill=(255, 255, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=AMARILLO)
    pw, ph = 86, 146
    d.rounded_rectangle((cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2), radius=22, fill=NEGRO)
    d.rounded_rectangle((cx - pw / 2 + 12, cy - ph / 2 + 22, cx + pw / 2 - 12, cy + ph / 2 - 30), radius=8, fill=(255, 255, 255))
    for k in range(4):
        tx = cx - pw / 2 + 18 + (k % 2) * 28
        ty = cy - ph / 2 + 30 + (k // 2) * 32
        d.rounded_rectangle((tx, ty, tx + 22, ty + 22), radius=7, fill=[(255, 157, 176), (126, 217, 154), (201, 167, 255), (255, 213, 74)][k])
    d.ellipse((cx - 8, cy + ph / 2 - 22, cx + 8, cy + ph / 2 - 6), fill=AMARILLO)
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make in (("portada", portada), ("fondo", fondo), ("icono", icono)):
        im = make().convert("RGB")
        im.save(OUT / f"{name}.png", optimize=True)
        print(f"ok assets/celular/{name}.png {im.size[0]}x{im.size[1]}")
