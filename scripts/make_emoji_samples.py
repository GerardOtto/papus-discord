"""Muestras de emojis para revisar: pack gratis (todos los Papus) y emojis nuevos del pack de pago (caras de las
Vocaloids y 20 de la biblioteca de stickers del motor, varios animados; (Puerro y superiores,
se suman a los 17 de assets/bots/emojis). Mismo estilo que scripts/make_emojis.py: caras en cuadrado, 128 px, fondo
transparente. El trío reutiliza el armado de scripts/make_stickers.py.
Salida: assets/emojis/<pack>/<nombre>.png (o .gif) y 00_vista_previa.png (grande, con nombres, sobre fondo de Discord).
Uso: python scripts/make_emoji_samples.py"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_stickers import load, square, triangle  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.abspath(os.path.join(ROOT, os.environ.get("ENGINE_DIR", "../Proyecto1")))
ANIMATED: set = set()
OUT = os.path.join(ROOT, "assets", "emojis")
SIZE = 128

# nombre: (personaje, archivo, centro x, centro y, lado) en fracciones del contenido visible.
FREE = {
    "teto_hola": ("teto", "presumido.png", 0.50, 0.17, 0.60),
    "miku_feliz": ("miku", "feliz.png", 0.30, 0.24, 0.55),
    "luka_hola": ("luka", "neutral.png", 0.50, 0.17, 0.42),
    "neru_jeje": ("neru", "feliz_2.png", 0.50, 0.45, 0.90),
    "gakupo": ("gakupo", "nerd_2.png", 0.45, 0.40, 0.80),
    "kaito": ("kaito", "feliz.png", 0.50, 0.35, 0.70),
    "flower": ("flower", "neutral.png", 0.50, 0.45, 1.00),
    "ia": ("ia", "feliz.png", 0.50, 0.35, 0.70),
    "haku": ("haku", "feliz.png", 0.50, 0.45, 0.85),
    "gumi": ("gumi", "feliz.png", 0.50, 0.30, 1.00),
}
PAID = {
    "kaito_helado": ("kaito", "decepcionado.png", 0.50, 0.45, 1.00),
    "flower_presume": ("flower", "presumido.png", 0.50, 0.45, 1.00),
    "ia_timida": ("ia", "timido.png", 0.45, 0.45, 1.00),
    "haku_perdon": ("haku", "timido.png", 0.50, 0.40, 0.85),
}
# De la biblioteca de stickers del motor (config/assets.json, tag "sticker"; solo lectura): nombre -> archivo.
# Los GIF quedan como emojis animados. Todo el catálogo entra (decisión de GyroP); estos llevan un nombre elegido a
# mano y el resto toma el de su id ("meme_v_rin_enojada" -> "rin_enojada"). Fuera solo las capturas de chat de
# seguidores (chat_*): son personas reales con su nombre a la vista.
NAMED = {
    # Renombrados: "teto_feliz" y "teto_risa" ya existen (caras de pago de assets/bots/emojis).
    "teto_chibi_feliz": "meme_v_teto_feliz.gif",
    "teto_carcajada": "meme_teto_risa.gif",
    "teto_baila": "meme_v_teto_baile.gif",
    "miku_baila": "meme_v_miku_baile.gif",
    "rin_baila": "meme_v_rin_baile.gif",
    "len_baila": "meme_v_len_baile.gif",
    "kaito_feliz": "meme_v_kaito_feliz.gif",
    "luka_chibi": "meme_v_luka_chibi.gif",
    "neru_burla": "meme_v_neru_burla.gif",
    "defoko_lentes": "meme_defoko_lentes.gif",
    "miku_lengua": "meme_v_miku_lengua.gif",
    "luka_aplaude": "meme_v_luka_aplaude.gif",
    "tako_luka": "meme_tako_luka.png",
    "pera_gumi": "meme_pera_gumi.png",
    "kiwi_gumi": "meme_kiwi_gumi.png",
    "miku_shock": "meme_miku_shock_puerro.png",
    "miku_puerro": "meme_miku_puerro_risa.png",
    "teto_asombro": "meme_v_teto_asombro.gif",
    "neru_preocupada": "meme_v_neru_preocupada.gif",
    "haku_chibi": "meme_haku_chibi.gif",
    "rei_nerd": "meme_rei_nerd.png",
    "luka_brillos": "meme_v_luka_brillos.gif",
}
MAX_BYTES = 256 * 1024
# De la biblioteca, estos van al pack GRATIS (reacciones divertidas para todos); el resto queda en el de pago.
FREE_FROM_LIBRARY = {
    "neru_phone", "miku_puerro_2", "teto_chibi_feliz", "rin_fist_pump", "luka_cheer", "miku_porrista",
    "gato_pulgar", "gato_sorprendido", "gato_lengua", "gato_nerd", "gato_tarjeta_roja", "nugget", "pera", "teto_carcajada",
    "len_triste", "rin_enojada",
}


def library():
    """Nombre del emoji -> archivo, para todo el catálogo de stickers del motor (sin las capturas de chat)."""
    data = json.load(open(os.path.join(ENGINE, "config", "assets.json"), encoding="utf-8"))
    items = data.get("assets", data)
    if isinstance(items, dict):
        items = [{"id": k, **v} for k, v in items.items() if isinstance(v, dict)]
    named_files = set(NAMED.values())
    out = dict(NAMED)
    for a in items:
        if "sticker" not in (a.get("tags") or []) or a["id"].startswith("chat_"):
            continue
        file = os.path.basename(a["path"])
        if file in named_files:
            continue
        name = re.sub(r"^(meme_v_|meme_|brand_sticker_)", "", a["id"])
        name = re.sub(r"[^a-z0-9_]", "_", name.lower())[:32]
        while name in out:
            name = f"{name[:30]}_2"
        out[name] = a["path"]
    return out

# Combos: se arman como en los stickers y se encajan en el cuadrado.
COMBOS = {
    "triple_baka": lambda: triangle(
        [square(load("miku", "feliz_11.png"), 0.5, 0.40, 0.80), square(load("teto", "riendo.png"), 0.5, 0.30, 0.60), square(load("neru", "r3d_riendo.png"), 0.5, 0.40, 0.75)]
    ),
}


def fit(img):
    img = img.copy()
    img.thumbnail((SIZE, SIZE), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE))
    out.alpha_composite(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2))
    return out


def frames_of(path):
    """Cuadros de un GIF ya compuestos (RGBA) con su duración; un PNG es un solo cuadro."""
    im = Image.open(path)
    out = []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        out.append((im.convert("RGBA"), im.info.get("duration", 80) or 80))
    return out


def save_library(name, src, dest_dir):
    """Emoji de la biblioteca: PNG si es fijo; GIF animado (128 px, < 256 KB) si se mueve, saltando cuadros si pesa mucho."""
    frames = frames_of(src)
    if len(frames) == 1:
        img = fit(frames[0][0].crop(frames[0][0].getbbox() or (0, 0, *frames[0][0].size)))
        img.save(os.path.join(dest_dir, f"{name}.png"), optimize=True)
        return img
    # Un recuadro común para todos los cuadros (que no "salte" la figura).
    box = None
    for f, _ in frames:
        b = f.getbbox()
        if b:
            box = b if not box else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    step = 1
    path = os.path.join(dest_dir, f"{name}.gif")
    while True:
        picked = frames[::step]
        imgs = [fit(f.crop(box)) for f, _ in picked]
        durs = [sum(d for _, d in frames[i : i + step]) for i in range(0, len(frames), step)]
        imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=durs, loop=0, disposal=2, optimize=True)
        if os.path.getsize(path) <= MAX_BYTES or step >= 6:
            break
        step += 1
    if os.path.getsize(path) > MAX_BYTES:
        raise SystemExit(f"{name}.gif sigue pesando más de 256 KB")
    return imgs[0]


def preview(pack, items):
    cell, cols = 200, (10 if len(items) > 20 else 5)
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (54, 57, 63, 255))
    d = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(items):
        x, y = (i % cols) * cell, (i // cols) * cell
        big = img.resize((150, 150), Image.LANCZOS)
        sheet.alpha_composite(big, (x + 25, y + 8))
        small = img.resize((32, 32), Image.LANCZOS)  # tamaño real dentro de un mensaje
        sheet.alpha_composite(small, (x + 8, y + 160))
        d.text((x + 46, y + 168), f":{name}:" + (" (animado)" if name in ANIMATED else ""), fill="white")
    sheet.convert("RGB").save(os.path.join(OUT, pack, "00_vista_previa.png"))


def main():
    packs = {
        "gratis": [(n, fit(square(load(c, f), cx, cy, s))) for n, (c, f, cx, cy, s) in FREE.items()],
        "pago": [(n, fit(square(load(c, f), cx, cy, s))) for n, (c, f, cx, cy, s) in PAID.items()] + [(n, fit(make())) for n, make in COMBOS.items()],
    }
    lib_dir = os.path.join(OUT, "pago")
    os.makedirs(lib_dir, exist_ok=True)
    lib = library()
    missing = FREE_FROM_LIBRARY - set(lib)
    if missing:
        raise SystemExit(f"No están en la biblioteca: {', '.join(sorted(missing))}")
    for name, file in lib.items():
        src = os.path.join(ENGINE, file) if "/" in file else os.path.join(ENGINE, "assets", "memes", file)
        pack = "gratis" if name in FREE_FROM_LIBRARY else "pago"
        os.makedirs(os.path.join(OUT, pack), exist_ok=True)
        packs[pack].append((name, save_library(name, src, os.path.join(OUT, pack))))
        if src.endswith(".gif") and getattr(Image.open(src), "n_frames", 1) > 1:
            ANIMATED.add(name)
    # Lista exacta de lo que sube `npm run emojis` (archivos sobrantes de versiones anteriores no entran).
    manifest = {pack: sorted(f"{n}.gif" if n in ANIMATED else f"{n}.png" for n, _ in items) for pack, items in packs.items()}
    with open(os.path.join(OUT, "packs.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"$comment": "Generado por scripts/make_emoji_samples.py: lo que sube npm run emojis (gratis = todos; pago = Puerro y superiores).", **manifest}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    for pack, items in packs.items():
        os.makedirs(os.path.join(OUT, pack), exist_ok=True)
        for name, img in items:
            if name in lib:
                continue
            path = os.path.join(OUT, pack, f"{name}.png")
            img.save(path, optimize=True)
            if os.path.getsize(path) > 256 * 1024:
                raise SystemExit(f"{pack}/{name}.png pesa más de 256 KB (límite de Discord para emojis)")
        preview(pack, items)
        print(f"ok {pack}: {len(items)} emojis")


if __name__ == "__main__":
    main()
