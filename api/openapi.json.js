// Vercel Edge Function wrapper: GET /api/openapi.json (free OpenAPI doc).
// File name "openapi.json.js" maps to the /api/openapi.json route.
// The shared handler in ../../lib/handler.js does all the work; this
// file only declares the Edge runtime.
import handler from "../lib/handler.js";

export const config = { runtime: "edge" };

export default function (request) {
  return handler.fetch(request);
}
