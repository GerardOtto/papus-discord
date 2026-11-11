"""Hoja de sprites de un Vocaloid para el mundo de los Papus (npm run mundo:sprites -- tet).

Renderiza con Blender (scripts/mundo_sprites_blender.py, pipeline de ../Diva-a-Render) 8 direcciones x 7 cuadros,
recorta todos los cuadros a la misma caja (la union de lo que ocupa el personaje) y los junta en dos hojas:
assets/mundo/<char>.webp (celdas de 256 de alto, la que carga siempre la plaza) y assets/mundo/<char>-hd.webp (512,
solo para las Vocaloids cerca de la camara), filas = direcciones y columnas = cuadros, + assets/mundo/<char>.json
(tamano de celda y donde quedan los pies; las dos hojas tienen la misma forma). Solo imagenes renderizadas: el modelo
nunca sale del PC.
"""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BLENDER = Path(r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe")
ALTO_CELDA = 256
# Hoja de detalle: el doble (con la camara a ras del suelo o con zoom, una Vocaloid ocupa 400-600 px de alto).
ALTO_CELDA_HD = 512
# Render al doble de la hoja HD, para que al achicar quede nitida.
RENDER = 1024
# Alto del personaje de pie en unidades del mundo (los Papus de cajas miden ~1,7, pero son mas anchos).
ALTO_PERSONAJE = 2.3
MARGEN = 4


def sangrar(hoja: Image.Image) -> Image.Image:
    """Pinta lo transparente con el color del borde mas cercano (sin tocar la transparencia).

    La pagina dibuja el contorno suavizado (no recorte de todo o nada): al filtrar la textura, los pixeles del borde se
    mezclan con sus vecinos transparentes, que si son negros dejan una linea oscura alrededor del personaje.
    """
    a = np.asarray(hoja, dtype=np.float32)
    lleno = a[..., 3] > 0
    color = a[..., :3] * lleno[..., None]
    peso = lleno.astype(np.float32)
    # Crece el color hacia afuera de a un pixel (promedio de los vecinos ya pintados), 12 pasos bastan para el filtrado.
    for _ in range(12):
        suma = np.zeros_like(color)
        cuenta = np.zeros_like(peso)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            suma += np.roll(color * peso[..., None], (dy, dx), axis=(0, 1))
            cuenta += np.roll(peso, (dy, dx), axis=(0, 1))
        nuevo = (cuenta > 0) & (peso == 0)
        color[nuevo] = suma[nuevo] / cuenta[nuevo][..., None]
        peso[nuevo] = 1
    out = np.concatenate([np.clip(color, 0, 255), a[..., 3:4]], axis=-1).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main() -> None:
    char = sys.argv[1] if len(sys.argv) > 1 else "tet"
    blender = shutil.which("blender") or str(BLENDER)
    tmp = Path(tempfile.mkdtemp(prefix=f"sprites-{char}-"))
    try:
        r = subprocess.run([blender, "-b", "--python", str(ROOT / "scripts" / "mundo_sprites_blender.py"), "--",
                            "--char", char, "--size", str(RENDER), "--out", str(tmp)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0 or not (tmp / "meta.json").exists():
            sys.exit(f"Blender fallo:\n{(r.stdout + r.stderr)[-2000:]}")
        meta = json.loads((tmp / "meta.json").read_text(encoding="utf-8"))
        dirs, cuadros, size = meta["direcciones"], meta["cuadros"], meta["size"]
        imgs = {(d, c): Image.open(tmp / f"d{d}_f{c}.png").convert("RGBA") for d in range(dirs) for c in range(cuadros)}

        # Caja comun: la union de todos los cuadros (asi el personaje no salta al cambiar de cuadro).
        cajas = [im.getbbox() for im in imgs.values() if im.getbbox()]
        izq = max(0, min(b[0] for b in cajas) - MARGEN)
        arr = max(0, min(b[1] for b in cajas) - MARGEN)
        der = min(size, max(b[2] for b in cajas) + MARGEN)
        aba = min(size, max(b[3] for b in cajas) + MARGEN)
        w, h = der - izq, aba - arr
        out = ROOT / "assets" / "mundo"
        out.mkdir(parents=True, exist_ok=True)
        cw, ch = 0, 0
        for alto, nombre in ((ALTO_CELDA_HD, f"{char}-hd"), (ALTO_CELDA, char)):
            # Mismo ancho proporcional en las dos (la HD mide exactamente el doble): la pagina cambia una por otra.
            ancho = round(w * ALTO_CELDA / h) * alto // ALTO_CELDA
            hoja = Image.new("RGBA", (ancho * cuadros, alto * dirs), (0, 0, 0, 0))
            for (d, c), im in imgs.items():
                hoja.paste(im.crop((izq, arr, der, aba)).resize((ancho, alto), Image.LANCZOS), (c * ancho, d * alto))
            sangrar(hoja).save(out / f"{nombre}.webp", "WEBP", quality=88, method=6, exact=True)
            if alto == ALTO_CELDA:
                cw, ch = ancho, alto

        # Pies: punto del suelo bajo el personaje, en coordenadas de la celda (0,0 = abajo a la izquierda, como
        # Sprite.center de three.js).
        # Se mide en el cuadro quieto mirando a la camara: centro de su caja y su borde de abajo (las suelas).
        quieto = imgs[(0, 0)].getbbox()
        pie = [round(((quieto[0] + quieto[2]) / 2 - izq) / w, 4), round(1 - (quieto[3] - arr) / h, 4)]
        datos = {"char": char, "direcciones": dirs, "cuadros": cuadros, "celda": [cw, ch], "pie": pie,
                 # Alto de la celda en unidades del mundo, para que de pie (cuadro 0) mida ALTO_PERSONAJE.
                 "alto": round(ALTO_PERSONAJE * h / (quieto[3] - quieto[1]), 3)}
        (out / f"{char}.json").write_text(json.dumps(datos), encoding="utf-8")
        kb = (out / f"{char}.webp").stat().st_size // 1024
        kb_hd = (out / f"{char}-hd.webp").stat().st_size // 1024
        print(f"✔ assets/mundo/{char}.webp ({kb} KB), {char}-hd.webp ({kb_hd} KB) y {char}.json")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
