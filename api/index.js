// Vercel Edge Function wrapper: GET /api (free info endpoint).
// The shared handler in ../../lib/handler.js does all the work; this
// file only declares the Edge runtime.
import handler from "../lib/handler.js";

export const config = { runtime: "edge" };

export default function (request) {
  return handler.fetch(request);
}
