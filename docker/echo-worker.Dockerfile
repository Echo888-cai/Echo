FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --bin echo-worker

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/echo-worker /usr/local/bin/echo-worker
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/echo-worker"]
