FROM node:22-bookworm-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv python-is-python3 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json /app/server/
COPY file-server/package*.json /app/file-server/

RUN npm --prefix /app/server install --omit=dev \
    && npm --prefix /app/file-server install --omit=dev

COPY file-server/processing/requirements.txt /app/file-server/processing/requirements.txt
RUN python3 -m venv "$VIRTUAL_ENV" \
    && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir -r /app/file-server/processing/requirements.txt

COPY server /app/server
COPY file-server /app/file-server

RUN mkdir -p /app/server/logs /app/file-server/logs /app/file-server/uploads

EXPOSE 8888 8885

CMD ["node", "server/server.js"]