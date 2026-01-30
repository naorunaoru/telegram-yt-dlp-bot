FROM node:23-alpine

# Add community repositories for hardware acceleration packages
RUN echo "https://dl-cdn.alpinelinux.org/alpine/v$(cut -d'.' -f1,2 /etc/alpine-release)/community/" >> /etc/apk/repositories
RUN apk update

# Install base dependencies and hardware acceleration libraries
RUN apk add --no-cache python3 py3-pip make g++ ffmpeg dcron \
    # VAAPI support
    libva libva-utils

WORKDIR /usr/src/app

COPY . .

RUN npm install && npm run build && pip install --break-system-packages "yt-dlp[default]"

# Configure yt-dlp to use Node.js (already in container) as its JS runtime
# Required for YouTube extraction (EJS challenge solving)
RUN mkdir -p /etc/yt-dlp && echo "--js-runtimes node" > /etc/yt-dlp/config

# Make scripts executable
RUN chmod +x /usr/src/app/docker-entrypoint.sh /usr/src/app/scripts/update-ytdlp.sh

EXPOSE 8081/tcp 8082/tcp

ENTRYPOINT ["/usr/src/app/docker-entrypoint.sh"]
