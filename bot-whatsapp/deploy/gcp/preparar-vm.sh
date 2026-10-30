#!/usr/bin/env bash
# Prepara el bot en una máquina virtual Ubuntu (por ejemplo Google Cloud e2-micro). Se ejecuta UNA vez, como tu usuario (no como root):
#   curl -fsSL https://raw.githubusercontent.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM/claude/eager-hamilton-gknalq/bot-whatsapp/deploy/gcp/preparar-vm.sh -o preparar-vm.sh && bash preparar-vm.sh
set -euo pipefail

RAMA="claude/eager-hamilton-gknalq"
REPO="https://github.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM.git"
DIR="$HOME/bot"

echo "== 1/5  Memoria de apoyo (swap de 1 GB: la máquina gratuita tiene poca RAM)"
if ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== 2/5  Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "== 3/5  Descargando el programa en $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else sudo apt-get install -y git >/dev/null; git clone -b "$RAMA" "$REPO" "$DIR"; fi
cd "$DIR/bot-whatsapp"

echo "== 4/5  Configuración (se crean las claves solas)"
if [ ! -f .env ]; then
  read -rp "Dominio del bot para los clientes (por ejemplo pedidos.distribucionesvm.es): " DOMINIO
  ADMIN=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)
  LINK=$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)
  PEPPER=$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)
  cat > .env <<EOF
DOMINIO=$DOMINIO
PUBLIC_URL=https://$DOMINIO
ADMIN_TOKEN=$ADMIN
LINK_SECRET=$LINK
NIF_PEPPER=$PEPPER
DRIVE_FOLDER_ID=
GOOGLE_SERVICE_ACCOUNT_FILE=
SYNC_MINUTES=15
EOF
  chmod 600 .env
  echo
  echo "  ┌──────────────────────────────────────────────────────────────────────────┐"
  echo "  │ TU CLAVE DE ADMINISTRADOR (apúntala ahora, es la de la vista de empresa): │"
  echo "  │   $ADMIN"
  echo "  │ Las otras claves están en $DIR/bot-whatsapp/.env (guarda una copia)      │"
  echo "  └──────────────────────────────────────────────────────────────────────────┘"
else
  echo "  Ya existe .env: no se toca."
fi

echo "== 5/5  Listo para arrancar"
echo "Antes de arrancar con HTTPS, el dominio tiene que apuntar a la IP de esta máquina (registro A en IONOS)."
echo "Cuando lo esté:"
echo "   cd $DIR/bot-whatsapp && sg docker -c 'docker compose --profile https up -d --build'"
echo "(si es la primera vez que se instala Docker, cierra y vuelve a abrir la sesión antes)"
