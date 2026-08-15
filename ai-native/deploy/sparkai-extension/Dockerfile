FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY services/sparkai-extension/package.json ./package.json
COPY services/sparkai-extension/src ./src

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 17910
VOLUME ["/data"]
CMD ["node", "src/main.mjs"]
