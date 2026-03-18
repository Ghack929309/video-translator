FROM node:20-alpine AS base
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN python3 -m pip install --break-system-packages yt-dlp

FROM base AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM base AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM base AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npx prisma generate
RUN npm run build

FROM base
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
COPY --from=build-env /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build-env /app/prisma /app/prisma
WORKDIR /app
CMD ["npm", "run", "start"]
