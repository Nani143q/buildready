FROM node:22.14.0-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

CMD ["node", "src/cli.js", "."]
