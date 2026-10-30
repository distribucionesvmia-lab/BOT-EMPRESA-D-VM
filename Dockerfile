# Imagen para Render en modo «Docker» con la raíz del repositorio como contexto (Root Directory vacío).
# Equivale a bot-whatsapp/Dockerfile, pero con los datos en /var/data: en Render hay que añadir un DISCO (Disks) montado en /var/data.
FROM node:22-slim
WORKDIR /app
COPY bot-whatsapp/ .
ENV NODE_ENV=production DB_PATH=/var/data/pedidos.sqlite EXPORT_DIR=/var/data/exportaciones BACKUP_DIR=/var/data/respaldos CATALOG_DB=/var/data/catalogo.sqlite CUSTOMERS_DB=/var/data/clientes.sqlite ACCOUNTS_DB=/var/data/cuentas.sqlite
EXPOSE 3000
CMD ["node", "server.js"]
