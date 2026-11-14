// Vercel Edge Function wrapper: GET /api/v1/faucets (paid, x402 v2).
// The shared handler in ../../../lib/handler.js does all the work; this
// file only declares the Edge runtime.
import handler from "../../lib/handler.js";

export const config = { runtime: "edge" };

export default function (request) {
  return handler.fetch(request);
}
