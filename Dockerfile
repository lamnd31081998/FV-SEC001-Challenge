FROM node:26-slim

WORKDIR /app

COPY package.json ./
COPY src ./src

ENTRYPOINT ["node", "src/cli.js"]
