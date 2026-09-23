FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server
COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/src server/src
RUN npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w server --omit=dev
COPY --from=build /app/server/dist server/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
