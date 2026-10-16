"""Genera los avatares cuadrados (1024x1024) y los banners (1360x480) de los 4 bots desde los avatares del motor
(solo lectura) y su paleta de characters.json. Salida: assets/bots/<id>_avatar.png y <id>_banner.png.
Uso: python scripts/make_avatars.py   (ENGINE_DIR por defecto ../Proyecto1)
Para cambiar la cara de un bot, editar SPEC (archivo y recorte relativo al contenido visible de la imagen)."""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "bots")

# avatar: imagen y recorte cuadrado (cx, cy, lado) en fracciones del contenido visible; banner: pose de cuerpo entero.
SPEC = {
    "teto": {"avatar": ("feliz_5.png", 0.50, 0.42, 0.95), "banner": "emocionado.png"},
    "miku": {"avatar": ("feliz_11.png", 0.50, 0.42, 0.95), "banner": "emocionado_6.png"},
    "luka": {"avatar": ("feliz_21.png", 0.50, 0.40, 0.95), "banner": "emocionado_5.png"},
    "neru": {"avatar": ("neutral_2.png", 0.50, 0.42, 0.95), "banner": "r3d_emocionado_5.png"},
}
AVATAR = 1024
BANNER = (1360, 480)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def radial(size, inner, outer, center=(0.5, 0.45)):
    """Degradado radial de `inner` (centro) a `outer` (bordes)."""
    w, h = size
    small = Image.new("RGB", (w // 4, h // 4))
    px = small.load()
    cx, cy = center[0] * small.width, center[1] * small.height
    rmax = ((max(cx, small.width - cx)) ** 2 + (max(cy, small.height - cy)) ** 2) ** 0.5
    for y in range(small.height):
        for x in range(small.width):
            t = min(1.0, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / rmax)
            px[x, y] = tuple(int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
    return small.resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))


def visible(img):
    box = img.getbbox()
    return img.crop(box) if box else img


def with_glow(img, color, radius=18):
    """Contorno suave del color del personaje para separar la figura del fondo."""
    alpha = img.split()[3].filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(radius))
    glow = Image.new("RGBA", img.size, color + (0,))
    glow.putalpha(alpha.point(lambda a: int(a * 0.55)))
    out = Image.new("RGBA", img.size)
    out.alpha_composite(glow)
    out.alpha_composite(img)
    return out


def make_avatar(cid, palette):
    name, cx, cy, side = SPEC[cid]["avatar"]
    img = visible(Image.open(os.path.join(ENGINE, "assets/characters", cid, name)).convert("RGBA"))
    w, h = img.size
    s = int(min(w, h) * side)
    left = max(0, min(w - s, int(cx * w - s / 2)))
    top = max(0, min(h - s, int(cy * h - s / 2)))
    face = img.crop((left, top, left + s, top + s)).resize((AVATAR, AVATAR), Image.LANCZOS)
    inner = tuple((a + b) // 2 for a, b in zip(hex_rgb(palette[1]), hex_rgb(palette[2])))
    bg = radial((AVATAR, AVATAR), inner, hex_rgb(palette[0])).convert("RGBA")
    bg.alpha_composite(with_glow(face, hex_rgb(palette[1])))
    bg.convert("RGB").save(os.path.join(OUT, f"{cid}_avatar.png"), optimize=True)


def make_banner(cid, palette):
    w, h = BANNER
    bg = radial(BANNER, hex_rgb(palette[1]), hex_rgb(palette[0]), center=(0.72, 0.5)).convert("RGBA")
    # Puntitos decorativos del color claro.
    dots = Image.new("RGBA", BANNER)
    d = ImageDraw.Draw(dots)
    light = hex_rgb(palette[2])
    for i in range(0, w, 40):
        for j in range(0, h, 40):
            if (i // 40 + j // 40) % 2 == 0:
                d.ellipse((i, j, i + 5, j + 5), fill=light + (50,))
    bg.alpha_composite(dots)
    pose = visible(Image.open(os.path.join(ENGINE, "assets/characters", cid, SPEC[cid]["banner"])).convert("RGBA"))
    # De la cintura para arriba: la pose mide ~1,8 veces el alto del banner y se corta abajo.
    scale = (h * 1.8) / pose.height
    pose = pose.resize((int(pose.width * scale), int(pose.height * scale)), Image.LANCZOS)
    pose = with_glow(pose, light, 14)
    layer = Image.new("RGBA", BANNER)
    layer.alpha_composite(pose, (max(0, min(w - pose.width, int(w * 0.72 - pose.width / 2))), int(h * 0.04)))
    bg.alpha_composite(layer)
    bg.convert("RGB").save(os.path.join(OUT, f"{cid}_banner.png"), optimize=True)


def main():
    chars = json.load(open(os.path.join(ENGINE, "config/characters.json"), encoding="utf-8"))["characters"]
    os.makedirs(OUT, exist_ok=True)
    for cid in sys.argv[1:] or SPEC:
        palette = chars[cid]["palette"]
        make_avatar(cid, palette)
        make_banner(cid, palette)
        print(f"ok {cid}")


if __name__ == "__main__":
    main()
