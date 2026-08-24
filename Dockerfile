# BCSK API — multi-stage so the runtime image carries no toolchain and no source.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
# --ignore-scripts skips postinstall; prisma generate runs explicitly in the build stage
# so a failure there is visible rather than buried in install output.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pdfkit reads .afm font data from disk and Prisma needs OpenSSL bindings.
RUN apk add --no-cache openssl tini

# Never run as root.
RUN addgroup -S bcsk && adduser -S bcsk -G bcsk

COPY --from=deps  --chown=bcsk:bcsk /app/node_modules ./node_modules
COPY --from=build --chown=bcsk:bcsk /app/dist         ./dist
COPY --from=build --chown=bcsk:bcsk /app/prisma       ./prisma
COPY --chown=bcsk:bcsk package*.json ./

USER bcsk
EXPOSE 4000

# tini reaps zombies and forwards signals, so `docker stop` is a clean shutdown rather
# than a SIGKILL after the timeout.
ENTRYPOINT ["/sbin/tini", "--"]

# Derives the path from the same variables the app uses, so changing API_VERSION cannot
# leave the healthcheck probing a route that no longer exists.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.API_PREFIX||'api',v=process.env.API_VERSION||'v1',port=process.env.PORT||4000;fetch('http://127.0.0.1:'+port+'/'+p+'/'+v+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]
