import { trace } from "@opentelemetry/api";
import pkg from "../../../../package.json";

export const tracer = trace.getTracer("reef-web", pkg.version);
