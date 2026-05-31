FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm install --include=dev

COPY . .

RUN ./node_modules/.bin/nest build

FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
