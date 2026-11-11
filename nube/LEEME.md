# Bots en la nube (Oracle Always Free)

Los bots corren en un servidor gratuito de Oracle en vez del PC: funcionan 24/7 aunque el PC esté apagado. El arranque en
el PC (tarea "Papus Discord", icono de la bandeja) **no se borra**: si algo falla, `nube volver` deja todo como antes.

Todo se hace desde el PC, en la carpeta del repo, con `nube\nube.cmd <comando>`.

> ⚠️ Nunca los bots en los dos lados a la vez: cada uno respondería dos veces y Neru moderaría doble.
> `trasladar` y `volver` se encargan de eso. Mientras estén en la nube, no uses `npm start` ni "Iniciar" en el PC.

## 1. Cuenta y servidor en Oracle (una vez, a mano)

1. Crear la cuenta en <https://signup.oraclecloud.com> (pide tarjeta para verificar; no cobra). **Región de origen:
   Chile Central (Santiago)** o la más cercana con "Ampere A1"; no se puede cambiar después.
2. Recomendado: en *Billing → Upgrade and Manage Payment*, pasar a **Pay As You Go**. Sigue en $0 mientras no se pase de
   lo gratuito, y Oracle ya no apaga la máquina por "inactiva" (además hay más capacidad para crearla).
3. *Compute → Instances → Create instance*:
   - Imagen: **Ubuntu 24.04** (Canonical Ubuntu 24.04, no "Minimal").
   - Shape: **Ampere → VM.Standard.A1.Flex**, con **4 OCPU y 24 GB** (o 2 y 12 si la cuenta solo permite eso).
   - Red: la que propone, con IP pública.
   - Llaves SSH: **Generate a key pair** y descargar la llave privada (`.key`). Guardarla en un lugar fijo, por ejemplo
     `C:\Users\UsuarioCompuElite\.ssh\oracle-papus.key`.
   - Si dice *Out of capacity*: probar otro "Availability domain" o reintentar más tarde.
4. Copiar la **IP pública** de la instancia.

## 1 (alternativa). Google Cloud e2-micro (gratis para siempre, 1 GB de RAM)

Los bots usan ~160 MB, así que caben; Gemma no (1 GB), por eso aquí se usa `preparar --sin-local`.

1. Crear la cuenta en <https://cloud.google.com/free> (tarjeta solo para verificar). Al terminar los 90 días de
   prueba, **activar la cuenta completa**: si no, Google apaga la máquina. La e2-micro sigue en $0.
2. *Compute Engine → VM instances → Create instance*:
   - Región **us-east1**, **us-central1** o **us-west1** (otras cobran).
   - Máquina: **e2-micro**.
   - Red: nivel **Estándar** (*Networking → Network service tier → Standard*). Da 200 GB al mes de tráfico de
     salida gratis; el Premium que viene por defecto solo 1 GB, y los GIF de la ruleta (~3 MB cada uno) lo pasan.
   - Disco de arranque: **Ubuntu 24.04 LTS (x86/64)**, tipo **Standard persistent disk** (el "Balanced" que viene
     por defecto cobra), 30 GB.
   - *Security → Manage access → Add item*: pegar la llave pública de `C:\Users\UsuarioCompuElite\.ssh\gcp-papus.pub`
     (el usuario queda como `papus`).
3. Copiar la **External IP**. No hace falta reservarla como estática (eso puede cobrar): solo cambia si se detiene y
   vuelve a iniciar la máquina, y entonces basta con repetir `conectar` con la nueva.
4. Conectar con `nube\nube.cmd conectar <IP> C:\Users\UsuarioCompuElite\.ssh\gcp-papus --usuario papus` y seguir abajo,
   con `preparar --sin-local`.

## 2. Preparar y subir (desde el PC)

```
nube\nube.cmd conectar <IP> C:\Users\UsuarioCompuElite\.ssh\oracle-papus.key
nube\nube.cmd preparar          (instala todo; con Gemma tarda ~15 min)
nube\nube.cmd subir             (código, datos del motor, nombres de carpetas del escritorio y .env)
nube\nube.cmd probar            (revisa .env, motor y APIs en el servidor; no conecta los bots)
```

## 3. Trasladar

```
nube\nube.cmd trasladar
```

Las chicas se despiden en el PC y vuelven desde el servidor en ~1 min. Se pausan las tareas del PC y se programa
"Papus Nube Sincronizar" (cada 30 min copia los datos del motor y las carpetas del escritorio). `data/` del PC queda
igual, como respaldo.

## 4. Volver al PC

```
nube\nube.cmd volver
```

Trae `data/` del servidor (lo que estaba en el PC queda en `data/respaldos/pc-<fecha>`), reactiva las tareas y arranca
los bots en el PC.

## Día a día

| Comando | Para qué |
|---|---|
| `estado` | Si están encendidos, memoria y últimas líneas del registro |
| `registro 100` | Últimas 100 líneas del registro |
| `subir` | Tras cambiar código o `.env`: sube solo lo cambiado y reinicia (se despiden y vuelven) |
| `reiniciar` / `detener` | Reinicia o detiene los bots del servidor |
| `npm niveles` / `npm pedidos` … | Corre un script que lee la base de datos, en el servidor (`npm conversaciones` sigue funcionando en el PC) |
| `traer revision` | Copia `data/revision` del servidor a `data/nube/revision` |

## Detalles

- Gemma queda cargado en memoria todo el tiempo: es el respaldo de las APIs y, además, evita que Oracle considere la
  máquina "inactiva" (la recupera si CPU, red y memoria quedan bajo el 20 % por 7 días). En CPU es lento, así que sigue
  siendo solo respaldo. Sin él: `preparar --sin-local` (entonces conviene Pay As You Go).
- Del motor viajan solo los archivos de `config/engine-paths.json` sin plantilla (~30 MB); de las carpetas del escritorio,
  solo los nombres de las subcarpetas (ningún video ni archivo).
- Un cambio en el lore del motor llega con la sincronización, pero los bots lo usan tras `nube\nube.cmd reiniciar`.
