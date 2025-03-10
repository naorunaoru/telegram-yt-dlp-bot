FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip make g++ ffmpeg

WORKDIR /usr/src/app

COPY . .

RUN npm install && npm run build && npm run download

EXPOSE 8081/tcp 8082/tcp

CMD ["npm", "start"]
