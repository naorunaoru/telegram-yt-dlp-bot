FROM node:23-alpine

# Add community repositories for hardware acceleration packages
RUN echo "https://dl-cdn.alpinelinux.org/alpine/v$(cut -d'.' -f1,2 /etc/alpine-release)/community/" >> /etc/apk/repositories
RUN apk update

# Install base dependencies and hardware acceleration libraries
RUN apk add --no-cache python3 py3-pip make g++ ffmpeg \
    # VAAPI support
    libva libva-utils

WORKDIR /usr/src/app

COPY . .

RUN npm install && npm run build && npm run download

EXPOSE 8081/tcp 8082/tcp

CMD ["npm", "start"]
