import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

export function startTelemetry(serviceName: string) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  if (!endpoint || sdk) return;

  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || "development"
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
      exportIntervalMillis: 30_000
    }),
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()]
  });
  sdk.start();

  const shutdown = () => void sdk?.shutdown();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function parseHeaders(raw?: string) {
  if (!raw) return undefined;
  return Object.fromEntries(raw.split(",").map((entry) => entry.split("=", 2).map(decodeURIComponent)).filter((parts) => parts.length === 2));
}
