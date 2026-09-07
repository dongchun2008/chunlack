FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lack
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY lack.py ./
COPY scripts/materialize.py scripts/materialize.py
RUN python3 scripts/materialize.py --output /app

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NODE_PATH=/opt/lack/node_modules LACK_BIND_HOST=0.0.0.0 LACK_ALLOW_SHELL=false HOME=/tmp
COPY --from=build /opt/lack/node_modules /opt/lack/node_modules
COPY --from=build /app /app
COPY deploy/entrypoint.cjs /opt/lack/entrypoint.cjs
RUN mv /app/config /opt/lack/default-config && mkdir -p /data && chown node:node /data \
    && for dir in config logs lineage research workspace lack_repos thread_repos agent_memories db k8s jspace .github; do ln -s /data/$dir /app/$dir; done
WORKDIR /app
USER node
EXPOSE 3721
ENTRYPOINT ["node", "/opt/lack/entrypoint.cjs"]
