FROM rust:1.85-bookworm AS build
WORKDIR /src
RUN rustup target add wasm32-unknown-unknown \
  && cargo install trunk --locked
COPY . .
RUN cd crates/echo-web && trunk build --release --no-color

FROM nginx:alpine
COPY --from=build /src/crates/echo-web/dist /usr/share/nginx/html
EXPOSE 80
