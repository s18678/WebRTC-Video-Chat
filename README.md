# Backend-only Docker image (Node 22 + Python)

This repository includes a backend-only Docker setup that packages:

- `server` (WebRTC signaling server)
- `file-server` (upload + merge server)
- `file-server/processing/merge_audio.py`

Mobile app directories are excluded from Docker build context.

## Build

From the repository root:

```sh
docker build -t webrtc-backend:node22 .
```

## Runtime `.env` files

Place your env files at:

- `server/.env`
- `file-server/.env`

Both folders are copied into the image, and both servers load env values.

## Run

The image now defaults to a single process (`server/server.js`) per container.

Run signaling server:

```sh
docker run --rm -p 8888:8888 \
  -e FILE_SERVER_ADDRESS=http://host.docker.internal:8885 \
  webrtc-backend:node22
```

Run file server:

```sh
docker run --rm -p 8885:8885 \
  --entrypoint node \
  webrtc-backend:node22 file-server/server.js
```

Optional signaling runtime overrides:

- `PORT` (default `8888`)
- `FILE_SERVER_ADDRESS` (required unless provided in `server/.env`)

Example:

```sh
docker run --rm -p 8888:8888 \
	-e PORT=8888 \
	-e FILE_SERVER_ADDRESS=http://host.docker.internal:8885 \
	webrtc-backend:node22
```

## Run with Docker Compose

Compose runs the backend as two separate services:

- `signaling-server` on `8888`
- `file-server` on `8885`

By default, signaling calls file-server via Docker DNS at `http://file-server:8885`.

```sh
docker compose up --build
```

Run detached:

```sh
docker compose up --build -d
```

Stop:

```sh
docker compose down
```
