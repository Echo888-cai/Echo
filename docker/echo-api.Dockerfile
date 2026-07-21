FROM rust:1.85-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release --bin echo-api

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/echo-api /usr/local/bin/echo-api
USER 10001:10001
EXPOSE 4180
ENTRYPOINT ["/usr/local/bin/echo-api"]
