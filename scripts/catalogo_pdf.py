"""Catálogo de objetos en PDF (descargable desde Discord y desde /catalogo/): las mismas tarjetas de ejemplo que la página,
como imágenes fijas, 8 por hoja, con nombre, rareza, tipo, descripción y cómo se consigue.
Lee worker/public/catalogo/catalogo.json (lo arma npm run catalogo) y escribe worker/public/catalogo/catalogo.pdf.
Uso: python -X utf8 scripts/catalogo_pdf.py
Discord deja subir hasta 10 MB sin mejoras del servidor: si se pasa, baja la calidad hasta que quepa."""
import io
import json
import os
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "worker", "public", "catalogo")
PW, PH = 1240, 1754  # A4 a 150 ppp
MARGEN, COLS, FILAS = 50, 2, 4
GAP = 30
CW = (PW - 2 * MARGEN - GAP) // COLS
IMG_H = round(CW * 340 / 1000)
CH = (PH - 170 - MARGEN) // FILAS
BG, PANEL, TXT, SUB = (22, 19, 31), (33, 28, 48), (236, 233, 245), (185, 178, 207)
LIMITE = 9.5 * 1024 * 1024


def fuente(nombres, size):
    for n in nombres:
        for d in ("C:/Windows/Fonts", "/usr/share/fonts/truetype/noto", "/usr/share/fonts/truetype/dejavu"):
            f = os.path.join(d, n)
            if os.path.exists(f):
                return ImageFont.truetype(f, size)
    return ImageFont.load_default()


NEGRITA = ["segoeuib.ttf", "NotoSans-Bold.ttf", "DejaVuSans-Bold.ttf"]
NORMAL = ["segoeui.ttf", "NotoSans-Regular.ttf", "DejaVuSans.ttf"]
F_TIT, F_SUB = fuente(NEGRITA, 46), fuente(NORMAL, 22)
F_NOM, F_CHIP, F_TXT = fuente(NEGRITA, 24), fuente(NEGRITA, 16), fuente(NORMAL, 17)


def color(hexa):
    h = hexa.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def chip(d, x, y, texto, fondo, tinta=(22, 19, 31)):
    w = d.textlength(texto, font=F_CHIP) + 18
    d.rounded_rectangle([x, y, x + w, y + 24], 12, fill=fondo)
    d.text((x + 9, y + 3), texto, font=F_CHIP, fill=tinta)
    return x + w + 6


def ajustar(d, texto, ancho, fnt, lineas):
    """Corta el texto en líneas que caben en `ancho` (con … si sobra)."""
    palabras, out, cur = texto.split(), [], ""
    for p in palabras:
        prueba = f"{cur} {p}".strip()
        if d.textlength(prueba, font=fnt) <= ancho:
            cur = prueba
        else:
            out.append(cur)
            cur = p
    if cur:
        out.append(cur)
    if len(out) > lineas:
        out = out[:lineas]
        while d.textlength(out[-1] + "…", font=fnt) > ancho and " " in out[-1]:
            out[-1] = out[-1].rsplit(" ", 1)[0]
        out[-1] += "…"
    return out


def pagina(items, n, total):
    im = Image.new("RGB", (PW, PH), BG)
    d = ImageDraw.Draw(im)
    d.text((MARGEN, 40), "Catálogo de los Papus", font=F_TIT, fill=TXT)
    d.text((MARGEN, 100), f"Objetos para tu tarjeta de nivel (/nivel) · /tienda · hoja {n} de {total}", font=F_SUB, fill=SUB)
    for k, o in enumerate(items):
        x = MARGEN + (k % COLS) * (CW + GAP)
        y = 170 + (k // COLS) * CH
        d.rounded_rectangle([x, y, x + CW, y + CH - 18], 16, fill=PANEL)
        try:
            tarjeta = Image.open(os.path.join(DIR, o["imagen"])).convert("RGB").resize((CW - 20, IMG_H - 7), Image.LANCZOS)
            im.paste(tarjeta, (x + 10, y + 10))
        except FileNotFoundError:
            pass
        ty = y + IMG_H + 10
        d.text((x + 12, ty), ajustar(d, o["nombre"], CW - 24, F_NOM, 1)[0], font=F_NOM, fill=TXT)
        cx = chip(d, x + 12, ty + 34, o["rareza"], color(o["color"]))
        cx = chip(d, cx, ty + 34, o["tipo"], (58, 51, 84), SUB)
        if o["animado"]:
            cx = chip(d, cx, ty + 34, "Animado", (58, 51, 84), SUB)
        if o["nuevo"]:
            chip(d, cx, ty + 34, "Nuevo", (255, 95, 162))
        for i, linea in enumerate(ajustar(d, f'{o["descripcion"]} {o["como"]}', CW - 24, F_TXT, 4)):
            d.text((x + 12, ty + 66 + i * 22), linea, font=F_TXT, fill=SUB)
    return im


def main():
    items = json.load(open(os.path.join(DIR, "catalogo.json"), encoding="utf-8"))
    por_hoja = COLS * FILAS
    hojas = [items[i : i + por_hoja] for i in range(0, len(items), por_hoja)]
    imagenes = [pagina(h, i + 1, len(hojas)) for i, h in enumerate(hojas)]
    for calidad in (80, 70, 60, 50, 40):
        # Cada hoja como JPEG (más liviano que PNG); PIL arma el PDF con ellas.
        jpgs = []
        for im in imagenes:
            b = io.BytesIO()
            im.save(b, "JPEG", quality=calidad, optimize=True)
            jpgs.append(Image.open(io.BytesIO(b.getvalue())))
        out = os.path.join(DIR, "catalogo.pdf")
        jpgs[0].save(out, "PDF", save_all=True, append_images=jpgs[1:], resolution=150, title="Catálogo de los Papus")
        size = os.path.getsize(out)
        print(f"calidad {calidad}: {size / 1024 / 1024:.1f} MB, {len(hojas)} hojas, {len(items)} objetos")
        if size <= LIMITE:
            break


if __name__ == "__main__":
    main()
