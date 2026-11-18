# Frontend Folio : build Vite, puis fichiers statiques servis par nginx non root.
# nginx relaie /api/ vers le backend sur le réseau interne et ajoute les en-têtes de sécurité.

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build
WORKDIR /src
COPY interface/package.json interface/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY interface/index.html interface/vite.config.js ./
COPY interface/public public
COPY interface/src src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD ["wget","-q","-O","/dev/null","http://127.0.0.1:8080/healthz"]
