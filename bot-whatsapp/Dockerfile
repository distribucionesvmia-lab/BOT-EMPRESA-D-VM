# Imagen para servidor propio (VPS) o cualquier plataforma con Docker
FROM node:22-slim
WORKDIR /app
COPY . .
# Datos persistentes (base de datos, exportaciones y copias): montar un volumen en /data
ENV NODE_ENV=production DB_PATH=/data/pedidos.sqlite EXPORT_DIR=/data/exportaciones BACKUP_DIR=/data/respaldos CATALOG_DB=/data/catalogo.sqlite CUSTOMERS_DB=/data/clientes.sqlite
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
