# Speech-to-text for speaking recordings (Phase 11): whisper.cpp's HTTP server, CPU only, English base model.
# Built and run by the stack on the VPS as `ielts-whisper` (internal network only, memory and CPU capped).
# The app sends each recording to POST /inference after it is saved and stores the text with the recording.
#
#   docker build -t ielts-whisper whisper/        (from the repo root)

FROM debian:bookworm-slim AS build
ARG WHISPER_VERSION=v1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "${WHISPER_VERSION}" https://github.com/ggml-org/whisper.cpp.git .
# static binaries, built for a generic x86-64 CPU (the image may move to another machine)
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
 && cmake --build build -j 2 --config Release --target whisper-server
RUN sh ./models/download-ggml-model.sh base.en && ls -l models/ggml-base.en.bin

FROM debian:bookworm-slim
# ffmpeg: the server's --convert turns the browser's webm / ogg / mp4 recordings into WAV
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app whisper
COPY --from=build /src/build/bin/whisper-server /app/whisper-server
COPY --from=build /src/models/ggml-base.en.bin /app/models/ggml-base.en.bin
WORKDIR /app
USER whisper
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["/app/whisper-server", "--host", "0.0.0.0", "--port", "8080", "-m", "/app/models/ggml-base.en.bin", "-t", "2", "--convert", "-l", "en"]
