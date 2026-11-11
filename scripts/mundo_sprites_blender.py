"""Cuadros de un Vocaloid para el mundo de los Papus: renders (nunca el modelo) en 8 direcciones x 7 cuadros
(0 = quieto, 1-6 = ciclo de caminar a saltos, estilo stop-motion), con camara ortografica inclinada como la del mundo.

Usa el pipeline de ../Diva-a-Render/DivaRenders (modelos extraidos del juego, materiales y luz de Project DIVA).
Lo llama scripts/mundo_sprites.py; a mano:
  blender -b --python scripts/mundo_sprites_blender.py -- --char tet --out <carpeta> [--size 256] [--samples 16]
Salida: <carpeta>/d<dir>_f<cuadro>.png y <carpeta>/meta.json (donde quedan los pies en el cuadro).
"""

import argparse
import json
import math
import os
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

DIVA = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Diva-a-Render", "DivaRenders"))
sys.path.insert(0, os.path.join(DIVA, "scripts"))
import diva_look  # noqa: E402
import diva_pose  # noqa: E402
import diva_rig  # noqa: E402
import render_diva  # noqa: E402
import render_pose as rp  # noqa: E402

DIRECCIONES = 8
PASOS = 6
# Inclinacion de la camara del mundo (atan(8.5 / 10.5) ~ 39 grados).
ELEVACION = 39.0


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--char", default="tet")
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=256)
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--expr", default="smile")
    return p.parse_args(argv)


def brazo(adelante):
    """Brazo por direccion (espacio del cuerpo de diva_pose: x = hacia afuera de ese brazo, y = hacia adelante,
    z = arriba): separado del cuerpo y con un vaiven amplio (pedido de GyroP, 9 nov. 2026). Rotar el brazo ya bajado
    ("upper": [x, y, z]) solo lo torcia sobre si mismo."""
    return {"upper_dir": [0.5, 0.9 * adelante, -1], "fore_dir": [0.35, 0.35 + 0.9 * max(0.0, adelante), -1]}


def pose_caminar(char, cuadro):
    """Cuadro 0: quieto. 1..6: ciclo de pasos (piernas, rodillas y brazos opuestos)."""
    arm = char.armature
    if cuadro == 0:
        diva_pose.apply_pose(char, {"arm_l": brazo(0), "arm_r": brazo(0)})
        return
    p = (cuadro - 1) / PASOS * 2 * math.pi
    s = math.sin(p)
    diva_pose.apply_pose(char, {
        "arm_l": brazo(-s),  # opuesto a la pierna izquierda
        "arm_r": brazo(s),
        "chest": [4, 0, 0],
    })
    for lado, adelante in (("l", s), ("r", -s)):
        # Muslo: x < 0 lo lleva adelante. Rodilla: x > 0 dobla (el pie va atras), mas al traer la pierna.
        trae = math.cos(p) if lado == "l" else -math.cos(p)
        diva_pose._set_world_rot(arm, f"j_momo_{lado}_wj", [-30 * adelante, 0, 0])
        diva_pose._set_world_rot(arm, f"j_sune_{lado}_wj", [6 + 40 * max(0.0, trae), 0, 0])
    bpy.context.view_layer.update()


def main():
    a = args()
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    cdir = render_diva.char_dir(os.path.join(DIVA, "extracted", "fbx", a.char))
    diva_look.apply_character_look(a.char)
    rp.clean_scene()
    char = diva_rig.load_character(cdir)
    with open(os.path.join(cdir, "motions.json"), encoding="utf-8") as f:
        motions = json.load(f)
    diva_look.build_materials(char.meshes)
    diva_look.add_hair_gradient(char)

    class R:
        width = height = a.size
        opaque = False
        samples = a.samples
    rp.setup_render(R)
    scene = bpy.context.scene
    arm = char.armature
    giro0 = arm.rotation_euler.z

    # Encuadre fijo para todos los cuadros: la caja de la pose quieta, con margen para pasos y brazos.
    pose_caminar(char, 0)
    diva_rig.apply_game_expressions(char)
    diva_rig.relax_hair(char, 0.35)
    diva_look.apply_expression(char, a.expr, motions)
    meshes = [m for m in char.meshes if not m.hide_render]
    _, lo, hi = rp.posed_points(meshes)
    alto = (hi - lo).z
    centro = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
    diva_look.setup_lighting(centro, alto)

    cam_data = bpy.data.cameras.new("Sprite")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = alto * 1.18
    cam = bpy.data.objects.new("Sprite", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    el = math.radians(ELEVACION)
    cam.location = centro + Vector((0, -math.cos(el), math.sin(el))) * alto * 4
    cam.rotation_euler = (centro - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    pie = world_to_camera_view(scene, cam, Vector((centro.x, centro.y, lo.z)))

    for cuadro in range(PASOS + 1):
        arm.rotation_euler.z = giro0
        bpy.context.view_layer.update()
        pose_caminar(char, cuadro)
        diva_rig.apply_game_expressions(char)
        diva_rig.relax_hair(char, 0.35)
        diva_look.apply_expression(char, a.expr, motions)
        for d in range(DIRECCIONES):
            # d = 0 mira a la camara; cada paso gira 45 grados hacia la derecha de la pantalla (como rotation.y en three.js).
            arm.rotation_euler.z = giro0 + math.radians(45 * d)
            bpy.context.view_layer.update()
            scene.render.filepath = os.path.join(out, f"d{d}_f{cuadro}.png")
            bpy.ops.render.render(write_still=True)
        print(f"[sprites] cuadro {cuadro} listo")

    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({"char": a.char, "direcciones": DIRECCIONES, "cuadros": PASOS + 1, "size": a.size,
                   "pie": [round(pie.x, 4), round(pie.y, 4)], "alto_en_cuadro": round(1 / 1.18, 4)}, f)
    print(f"[sprites] OK {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        print(f"[ERROR] {type(e).__name__}: {e}")
        sys.exit(1)
