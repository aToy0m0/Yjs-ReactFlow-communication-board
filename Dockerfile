FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

ARG NEXT_PUBLIC_COLLAB_URL=ws://localhost:1234
ENV NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL

COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/lib ./lib
COPY --from=build /app/auth-store-module.d.ts ./auth-store-module.d.ts
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/server.mjs ./server.mjs

RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3010 1234

CMD ["npm", "start"]
