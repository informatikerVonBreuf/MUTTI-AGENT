# syntax=docker/dockerfile:1
# Backend Folio : serveur Node (API, sessions, recherche BM25) + worker Python/LangGraph.
# Les deux restent dans le même conteneur : le serveur lance le worker comme processus enfant.
# Contexte de build : racine du dépôt (voir docker-compose.yml).

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS node

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df AS worker-deps
WORKDIR /deps
COPY docker/requirements-worker.txt .
# Versions figées et empreintes vérifiées (--require-hashes) ; installation hors de site-packages.
RUN pip install --no-cache-dir --no-compile --require-hashes --target /deps/site -r requirements-worker.txt

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=worker-deps /deps/site /opt/worker-site
RUN groupadd --system --gid 10001 folio \
 && useradd --system --uid 10001 --gid folio --home-dir /app --no-create-home --shell /usr/sbin/nologin folio \
 && mkdir -p /data/runtime /app/data/rag-data \
 && chown folio:folio /data/runtime
ENV NODE_ENV=production \
    PYTHONPATH=/opt/worker-site \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    UV_THREADPOOL_SIZE=8 \
    FOLIO_HOST=0.0.0.0 \
    FOLIO_PYTHON=python3 \
    FOLIO_DATA_DIR=/data/runtime
WORKDIR /app
COPY --chown=root:root interface/package.json interface/package.json
COPY --chown=root:root interface/server interface/server
COPY --chown=root:root scripts/__init__.py scripts/folio_worker.py scripts/security_paths.py scripts/
RUN rm -f interface/server/*.test.mjs
USER folio
WORKDIR /app/interface
EXPOSE 5173
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node","-e","fetch('http://127.0.0.1:5173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","--use-system-ca","server/index.mjs"]
