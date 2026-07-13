export function temporalConnectionOptions() {
  const apiKey = process.env.TEMPORAL_API_KEY;
  const tls = process.env.TEMPORAL_TLS === "1" || Boolean(apiKey) ? {} : undefined;
  return {
    address: process.env.TEMPORAL_ADDRESS || "localhost:7233",
    tls,
    apiKey
  };
}

export function temporalNamespace() {
  return process.env.TEMPORAL_NAMESPACE || "default";
}

export function temporalTaskQueue() {
  return process.env.TEMPORAL_TASK_QUEUE || "echo-research";
}
