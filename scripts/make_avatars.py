"""Genera los avatares cuadrados (1024x1024) y los banners (1360x480) de los bots desde los avatares del motor
(solo lectura) y su paleta de characters.json. Salida: assets/bots/<id>_avatar.png y <id>_banner.png.
Personajes que no estan en characters.json del motor (Ruko): paleta en content/lore-extra.json -> display.
Tambien las figuras del podio de /ranking (<id>_figura.png).
Uso: python scripts/make_avatars.py [ids] [--figuras]   (ENGINE_DIR por defecto ../Proyecto1; --figuras: solo las figuras)
     python scripts/make_avatars.py [ids] --navidad   trajes de Navidad desde los renders de Diva-a-Render
     (DIVA_DIR, por defecto ../Diva-a-Render/DivaRenders/output/navidad; salida assets/bots/navidad/, y los renders
     a 1024 en assets/bots/navidad/renders/<id>_<reaccion>.png para las tarjetas personalizables).
     python scripts/make_avatars.py --modelos   renders de los modelos nuevos con su traje propio (IA, flower, Adachi
     Rei y Ruko; Diva-a-Render output/modelos_nuevos, looks base_*.json) a 1024 en assets/coleccion/renders/, para los
     fondos de tarjeta de la temporada 2 (scripts/temporada2.ts).
Para cambiar la cara de un bot, editar SPEC (archivo y recorte relativo al contenido visible de la imagen)."""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
OUT = os.path.join(ROOT, "assets", "bots")

# avatar: imagen y recorte cuadrado (cx, cy, lado) en fracciones del contenido visible; banner: pose de cuerpo entero;
# figura (podio del /ranking): pose sin cortes en los bordes y fraccion de arriba que se conserva (el podio tapa las piernas).
SPEC = {
    "teto": {"avatar": ("feliz_5.png", 0.50, 0.42, 0.95), "banner": "emocionado.png", "figura": ("emocionado.png", 0.85)},
    "miku": {"avatar": ("feliz_11.png", 0.50, 0.42, 0.95), "banner": "emocionado_6.png", "figura": ("emocionado_6.png", 0.75)},
    "luka": {"avatar": ("feliz_21.png", 0.50, 0.40, 0.95), "banner": "emocionado_5.png", "figura": ("emocionado_5.png", 0.9)},
    "neru": {"avatar": ("neutral_2.png", 0.50, 0.42, 0.95), "banner": "r3d_emocionado_5.png", "figura": ("feliz.png", 1.0)},
    "gakupo": {"avatar": ("nerd_2.png", 0.50, 0.42, 0.95), "banner": "maduro_feliz.png", "figura": ("maduro_feliz.png", 0.75)},
    "kaito": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "emocionado.png", "figura": ("feliz.png", 1.0)},
    "flower": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "presumido.png", "figura": ("presumido_2.png", 1.0)},
    "ia": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "saludando.png", "figura": ("feliz_2.png", 1.0)},
    "haku": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "saludando.png", "figura": ("emocionado_3.png", 0.62)},
    "gumi": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "emocionado.png", "figura": ("emocionado.png", 0.85)},
    "rin": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "emocionado.png", "figura": ("emocionado_3.png", 0.8)},
    "len": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "presumido.png", "figura": ("emocionado_2.png", 0.62)},
    "meiko": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "saludando.png", "figura": ("emocionado.png", 0.72)},
    "adachirei": {"avatar": ("feliz.png", 0.50, 0.40, 0.95), "banner": "emocionado.png", "figura": ("saludando.png", 1.0)},
    # ruko: imagenes en el motor (assets/characters/ruko, 20 oct. 2026); avatar = su cara de la imagen principal (GyroP).
    "ruko": {"avatar": ("feliz.png", 0.49, 0.125, 0.40), "banner": "emocionado.png", "figura": ("feliz.png", 0.5)},
}
# Navidad 2026 (12 nov.): renders de Diva-a-Render (busto 2048, trajes Santa del juego o cabezas sobre ellos).
# Carpeta relativa a DIVA_DIR y codigo del personaje del juego que nombra los PNG (<codigo>_<reaccion>.png).
NAVIDAD = {
    "miku": "mik", "rin": "rin", "len": "len", "luka": "luk", "kaito": "kai", "meiko": "mei",
    "teto": "_teto/tet", "neru": "_neru/ner", "haku": "_haku/hak", "gumi": "_gumi/mik", "gakupo": "_gakupo/kai",
    "ia": "_ia/ner", "adachirei": "_adachirei/rin", "ruko": "_ruko/sak", "flower": "_flower/hak",
}
# Busto completo (2048): el avatar abarca todo el ancho para que entren el gorro y las manos; el banner amplia mas.
NAVIDAD_SPEC = {"avatar": ("feliz", 0.50, 0.29, 1.0), "banner": "emocionado", "banner_escala": 1.3,
                "figura": ("saludando", 1.0)}
# Las 17 reacciones del motor (reaction_sets.py all): variedad de caras y poses para las tarjetas.
NAVIDAD_REACCIONES = ("neutral", "feliz", "riendo", "emocionado", "saludando", "presumido", "nerd", "pensando",
                      "enojado", "gritando", "decepcionado", "triste", "nervioso", "timido", "sorprendido",
                      "shocked", "broma")
DIVA = os.path.abspath(os.path.join(ROOT, os.environ.get("DIVA_DIR", "../Diva-a-Render/DivaRenders/output/navidad")))

AVATAR = 1024
BANNER = (1360, 480)
FIGURA = 640  # alto maximo


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


def palette_of(char):
    """Paleta del motor (oscuro, medio, claro); si no la tiene (IA, Haku), sale de su subtitleColor."""
    if char.get("palette"):
        return char["palette"]
    mid = hex_rgb(char["subtitleColor"])
    to_hex = lambda c: "#%02X%02X%02X" % tuple(c)
    dark = [int(v * 0.22) for v in mid]
    light = [int(v + (255 - v) * 0.7) for v in mid]
    return [to_hex(dark), to_hex(mid), to_hex(light)]


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


def source(cid, name):
    if cid in NAVIDAD_ON:
        folder = NAVIDAD[cid]
        return os.path.join(DIVA, folder, f"{os.path.basename(folder)}_{name}.png")
    return os.path.join(ENGINE, "assets/characters", cid, name)


NAVIDAD_ON = set()


def spec_of(cid):
    return NAVIDAD_SPEC if cid in NAVIDAD_ON else SPEC[cid]


def keep_renders(cid):
    """Copia los renders navidenos (1024, transparentes) para usarlos tambien en las tarjetas."""
    out = os.path.join(OUT, "renders")
    os.makedirs(out, exist_ok=True)
    for r in NAVIDAD_REACCIONES:
        if not os.path.exists(source(cid, r)):
            print(f"  falta {cid} {r}")
            continue
        img = Image.open(source(cid, r)).convert("RGBA")
        img.thumbnail((1024, 1024), Image.LANCZOS)
        img.save(os.path.join(out, f"{cid}_{r}.png"), optimize=True)


def make_avatar(cid, palette):
    name, cx, cy, side = spec_of(cid)["avatar"]
    img = visible(Image.open(source(cid, name)).convert("RGBA"))
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
    pose = visible(Image.open(source(cid, spec_of(cid)["banner"])).convert("RGBA"))
    # De la cintura para arriba: la pose mide ~1,8 veces el alto del banner y se corta abajo.
    scale = (h * spec_of(cid).get("banner_escala", 1.8)) / pose.height
    pose = pose.resize((int(pose.width * scale), int(pose.height * scale)), Image.LANCZOS)
    pose = with_glow(pose, light, 14)
    layer = Image.new("RGBA", BANNER)
    layer.alpha_composite(pose, (max(0, min(w - pose.width, int(w * 0.72 - pose.width / 2))), int(h * 0.04)))
    bg.alpha_composite(layer)
    bg.convert("RGB").save(os.path.join(OUT, f"{cid}_banner.png"), optimize=True)


def fade_cut_edges(img, band=28):
    """Si la pose viene cortada arriba o a los lados en el motor, el borde se desvanece en vez de quedar recto."""
    alpha = img.getchannel("A")
    w, h = img.size
    solid = alpha.point(lambda v: 255 if v > 128 else 0)
    edges = {"top": (0, 0, w, 2), "left": (0, 0, 2, h), "right": (w - 2, 0, w, h)}
    px = alpha.load()
    for side, box in edges.items():
        if solid.crop(box).histogram()[255] == 0:
            continue
        for k in range(band):
            f = k / band
            if side == "top":
                for x in range(w):
                    px[x, k] = int(px[x, k] * f)
            else:
                x = k if side == "left" else w - 1 - k
                for y in range(h):
                    px[x, y] = int(px[x, y] * f)
    img.putalpha(alpha)
    return img


def make_figure(cid):
    """Figura recortada (PNG con transparencia) para el podio de /ranking: assets/bots/<id>_figura.png."""
    name, keep = spec_of(cid)["figura"]
    img = fade_cut_edges(visible(Image.open(source(cid, name)).convert("RGBA")))
    img = img.crop((0, 0, img.width, int(img.height * keep)))
    img = img.crop(img.getbbox())
    if img.height > FIGURA:
        img = img.resize((int(img.width * FIGURA / img.height), FIGURA), Image.LANCZOS)
    img.save(os.path.join(OUT, f"{cid}_figura.png"), optimize=True)


# Modelos nuevos (mods de Mega Mix+ bajados por GyroP, 12 nov. 2026): codigo del personaje del juego que ocupan.
MODELOS = {"ia": "ner", "adachirei": "rin", "ruko": "sak", "flower": "hak"}


def copy_models():
    src = os.path.join(os.path.dirname(DIVA), "modelos_nuevos")
    out = os.path.join(ROOT, "assets", "coleccion", "renders")
    os.makedirs(out, exist_ok=True)
    for bot, code in MODELOS.items():
        folder = os.path.join(src, code)
        files = sorted(f for f in os.listdir(folder) if f.endswith(".png")) if os.path.isdir(folder) else []
        for f in files:
            img = Image.open(os.path.join(folder, f)).convert("RGBA")
            img.thumbnail((1024, 1024), Image.LANCZOS)
            img.save(os.path.join(out, f"{bot}_{f[len(code) + 1:]}"), optimize=True)
        print(f"{'ok' if files else 'sin renders'} {bot} ({len(files)})")


def main():
    global OUT
    if "--modelos" in sys.argv:
        return copy_models()
    navidad = "--navidad" in sys.argv
    if navidad:
        OUT = os.path.join(OUT, "navidad")
    chars = json.load(open(os.path.join(ENGINE, "config/characters.json"), encoding="utf-8"))["characters"]
    extra = json.load(open(os.path.join(ROOT, "content/lore-extra.json"), encoding="utf-8")).get("display", {})
    chars = {**extra, **chars}
    os.makedirs(OUT, exist_ok=True)
    only_figures = "--figuras" in sys.argv
    for cid in [a for a in sys.argv[1:] if not a.startswith("--")] or (NAVIDAD if navidad else SPEC):
        if navidad:
            NAVIDAD_ON.add(cid)
            keep_renders(cid)
        if not only_figures:
            palette = palette_of(chars[cid])
            make_avatar(cid, palette)
            make_banner(cid, palette)
        make_figure(cid)
        print(f"ok {cid}")


if __name__ == "__main__":
    main()
