#!/usr/bin/env bash
# Prepara el servidor (Ubuntu 24.04, Oracle Always Free u otro) para los bots de los Papus. Lo corre `nube preparar`
# desde el PC; se puede repetir sin problema (cada paso revisa si ya esta hecho).
#   bash preparar.sh <version-de-node> [--sin-local]
# Deja el servicio "papus" instalado pero APAGADO: los bots arrancan aqui solo con `nube trasladar`, para que nunca
# corran a la vez en el PC y en el servidor.
set -euo pipefail

NODE_VERSION="${1:?falta la version de Node (ej.: 24.14.1)}"
SIN_LOCAL="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$HOME/papus"
USER_NAME="$(id -un)"

paso() { echo; echo "== $*"; }

paso "Zona horaria de Chile (horas del registro)"
sudo timedatectl set-timezone America/Santiago

paso "Paquetes del sistema"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates xz-utils zstd logrotate > /dev/null
# Fuentes para las imagenes (tarjetas, ranking, bodas): la imagen de Ubuntu no trae ninguna y sin ellas no sale texto.
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-dejavu-core fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji > /dev/null

if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && ! swapon --show | grep -q .; then
  paso "Memoria de intercambio de 1 GB (maquina con menos de 2 GB, ej.: e2-micro de Google)"
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile > /dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

paso "Node $NODE_VERSION (la misma version del PC)"
case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Arquitectura no soportada: $(uname -m)"; exit 1 ;;
esac
if [ "$(/usr/local/bin/node -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  DIR="node-v$NODE_VERSION-linux-$ARCH"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$DIR.tar.xz" -o "/tmp/$DIR.tar.xz"
  sudo tar -xJf "/tmp/$DIR.tar.xz" -C /opt
  rm -f "/tmp/$DIR.tar.xz"
  for b in node npm npx; do sudo ln -sf "/opt/$DIR/bin/$b" "/usr/local/bin/$b"; done
fi
/usr/local/bin/node -v

paso "Carpetas en $BASE"
mkdir -p "$BASE/app/data" "$BASE/motor" "$BASE/entrega" "$BASE/respaldos"

paso "Servicio papus (instalado, sin arrancar)"
sudo tee /etc/systemd/system/papus.service > /dev/null <<EOF
[Unit]
Description=Bots del Discord de los Papus (Teto, Miku, Luka, Neru y los Vocaloids de conversacion)
Wants=network-online.target
After=network-online.target ollama.service

[Service]
User=$USER_NAME
WorkingDirectory=$BASE/app
Environment=TZ=America/Santiago
ExecStart=/usr/local/bin/node --disable-warning=ExperimentalWarning --import tsx src/main.ts
# Como run-bots.cmd en el PC: si se cae, vuelve a los 15 s. Al detenerlo (SIGTERM) las chicas se despiden.
Restart=always
RestartSec=15
KillSignal=SIGTERM
TimeoutStopSec=30
StandardOutput=append:$BASE/app/data/bots.log
StandardError=inherit

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/logrotate.d/papus > /dev/null <<EOF
$BASE/app/data/bots.log {
  size 5M
  rotate 3
  compress
  missingok
  notifempty
  copytruncate
  su $USER_NAME $USER_NAME
}
EOF
sudo systemctl daemon-reload

if [ "$SIN_LOCAL" = "--sin-local" ]; then
  paso "Sin modelo local (--sin-local): solo APIs"
else
  paso "Ollama con papus-gemma (respaldo de las APIs)"
  if ! command -v ollama > /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  # El modelo queda cargado en memoria para siempre: responde sin esperar a cargarse y, de paso, el servidor no
  # parece "inactivo" para Oracle (recupera las maquinas gratuitas con CPU, red y memoria bajo el 20 % por 7 dias).
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  printf '[Service]\nEnvironment=OLLAMA_KEEP_ALIVE=-1\nEnvironment=OLLAMA_HOST=127.0.0.1:11434\n' | sudo tee /etc/systemd/system/ollama.service.d/papus.conf > /dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now ollama > /dev/null 2>&1
  sudo systemctl restart ollama
  for _ in $(seq 1 30); do curl -fs http://127.0.0.1:11434/api/version > /dev/null && break; sleep 1; done
  BASE_MODEL="$(sed -n 's/^FROM[[:space:]]*//p' "$HERE/papus-gemma.Modelfile" | head -1)"
  ollama pull "$BASE_MODEL"
  ollama create papus-gemma -f "$HERE/papus-gemma.Modelfile"
  # Carga el modelo al arrancar la maquina (sin generar nada) para que quede en memoria desde el inicio. Va en un
  # script aparte: systemd cambia las comillas y barras de un comando en linea y Ollama rechazaba el JSON.
  sudo tee /usr/local/bin/papus-gemma-cargar > /dev/null <<'EOF'
#!/bin/sh
for _ in $(seq 1 60); do curl -fs http://127.0.0.1:11434/api/version > /dev/null && break; sleep 2; done
curl -fsS http://127.0.0.1:11434/api/generate -d '{"model": "papus-gemma", "keep_alive": -1}' > /dev/null
EOF
  sudo chmod 755 /usr/local/bin/papus-gemma-cargar
  sudo tee /etc/systemd/system/papus-gemma.service > /dev/null <<'EOF'
[Unit]
Description=Carga papus-gemma en memoria (Ollama)
Wants=ollama.service
After=ollama.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/papus-gemma-cargar

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable papus-gemma > /dev/null 2>&1
  sudo systemctl start papus-gemma
  ollama ps
fi

paso "Listo. Siguiente paso en el PC: nube subir"
