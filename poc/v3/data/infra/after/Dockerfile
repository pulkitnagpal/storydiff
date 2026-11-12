# node:sqlite (used by db.js) needs Node 22.13+; we run Node 25 everywhere.
FROM node:25-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    LINKBOX_DB=/data/linkbox.db

WORKDIR /app

# No dependencies, so there is no npm install step.
COPY package.json server.js db.js ./
COPY public ./public

# Keep the SQLite file on a volume, owned by the unprivileged node user.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
CMD ["node", "server.js"]
