// Local verification harness for the Testnet Toolkit Netlify port.
// Imports the Netlify edge-function module directly and calls its
// default-exported handler function — no deploy needed. Run with:
//   NODE_USE_ENV_PROXY=1 node test/harness.mjs
// (proxy env is needed so the handler's outbound fetch to the x402
// facilitator and public RPCs works from this VM.)
import handler, { weiToGweiString, weiToEthString } from "../edge-functions/api.js";
import fs from "node:fs";

const BASE = "https://testnet-toolkit.netlify.app";
const PAY_TO = "0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; failures.push(name); console.log(`FAIL  ${name} ${detail}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function req(path, opts = {}) {
  return handler(new Request(BASE + path, opts));
}

function checkOffer(name, res, body) {
  check(`${name}: status 402`, res.status === 402, `(got ${res.status})`);
  check(`${name}: body x402Version 2`, body.x402Version === 2);
  check(`${name}: body error set`, typeof body.error === "string" && body.error.length > 0);
  check(`${name}: body resource.url present`, typeof body.resource?.url === "string" && body.resource.url.includes("/v1/"));
  const a = body.accepts?.[0];
  check(`${name}: accepts[0].scheme exact`, a?.scheme === "exact");
  check(`${name}: accepts[0].network eip155:8453`, a?.network === "eip155:8453");
  check(`${name}: accepts[0].amount 1000`, a?.amount === "1000");
  check(`${name}: accepts[0].asset USDC Base`, a?.asset === USDC_BASE);
  check(`${name}: accepts[0].payTo agent wallet`, a?.payTo === PAY_TO);
  check(`${name}: accepts[0].maxTimeoutSeconds 120`, a?.maxTimeoutSeconds === 120);
  check(`${name}: accepts[0].extra name/version`, a?.extra?.name === "USD Coin" && a?.extra?.version === "2");
  const hdr = res.headers.get("PAYMENT-REQUIRED");
  check(`${name}: PAYMENT-REQUIRED header present`, !!hdr);
  let decoded = null;
  try { decoded = JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); } catch { /* ignore */ }
  check(`${name}: PAYMENT-REQUIRED decodes to same offer`, decoded !== null && eq(decoded, body));
  check(`${name}: CORS expose PAYMENT-REQUIRED`, (res.headers.get("Access-Control-Expose-Headers") || "").includes("PAYMENT-REQUIRED"));
  check(`${name}: CORS expose PAYMENT-RESPONSE`, (res.headers.get("Access-Control-Expose-Headers") || "").includes("PAYMENT-RESPONSE"));
  check(`${name}: CORS allow-origin *`, res.headers.get("Access-Control-Allow-Origin") === "*");
}

// 0. Unit tests for the wei formatting helpers (used by /v1/gas + /v1/balance).
{
  check("weiToGweiString 1 gwei", weiToGweiString("0x3B9ACA00") === "1");
  check("weiToGweiString 16 wei (observed Sepolia gasPrice)", weiToGweiString("0x10") === "0.000000016");
  check("weiToGweiString 6000000 wei (observed Base Sepolia gasPrice)", weiToGweiString("0x5b8d80") === "0.006");
  check("weiToEthString 1 ETH", weiToEthString("0xDE0B6B3A7640000") === "1");
  const eth = weiToEthString("0x20278062cd56730"); // observed Sepolia balance (Wallet Satu)
  const [w, f = ""] = eth.split(".");
  const back = BigInt(w) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0");
  check("weiToEthString round-trips observed balance", back === 0x20278062cd56730n, `(got ${eth})`);
}

// 1. 402 paths (no payment) — all three paid endpoints.
for (const [label, path] of [
  ["gas/sepolia", "/api/v1/gas?chain=sepolia"],
  ["gas/base-sepolia", "/api/v1/gas?chain=base-sepolia"],
  ["balance", "/api/v1/balance?chain=base-sepolia&address=0x0F4D4e842fd210380D57C6D5cef204D4F75f6121"],
  ["faucets/sepolia", "/api/v1/faucets?chain=sepolia"],
  ["faucets/base-sepolia", "/api/v1/faucets?chain=base-sepolia"],
]) {
  const res = await req(path);
  const body = await res.json();
  checkOffer(label, res, body);
}

// 2. Validation errors (before payment — cheap, clear 400s).
{
  const res = await req("/api/v1/gas?chain=mainnet");
  const body = await res.json();
  check("gas bad chain: status 400", res.status === 400, `(got ${res.status})`);
  check("gas bad chain: lists supportedChains", Array.isArray(body.supportedChains) && body.supportedChains.includes("sepolia") && body.supportedChains.includes("base-sepolia"));
}
{
  const res = await req("/api/v1/gas");
  check("gas missing chain: status 400", res.status === 400, `(got ${res.status})`);
}
{
  const res = await req("/api/v1/balance?chain=sepolia&address=not-an-address");
  check("balance bad address: status 400", res.status === 400, `(got ${res.status})`);
}
{
  const res = await req("/api/v1/balance?chain=sepolia");
  check("balance missing address: status 400", res.status === 400, `(got ${res.status})`);
}

// 3. CORS preflight.
{
  const res = await req("/api/v1/gas?chain=sepolia", { method: "OPTIONS" });
  check("OPTIONS: status 204", res.status === 204, `(got ${res.status})`);
  check("OPTIONS: allow-methods includes GET", (res.headers.get("Access-Control-Allow-Methods") || "").includes("GET"));
  check("OPTIONS: expose headers present", (res.headers.get("Access-Control-Expose-Headers") || "").includes("PAYMENT-RESPONSE"));
}

// 4. Free endpoints.
{
  const res = await req("/api");
  const body = await res.json();
  check("GET /api: status 200", res.status === 200, `(got ${res.status})`);
  check("GET /api: service name", body.service === "Testnet Toolkit");
}
{
  const res = await req("/api/openapi.json");
  const body = await res.json();
  check("GET /api/openapi.json: status 200", res.status === 200, `(got ${res.status})`);
  check("GET /api/openapi.json: openapi 3.0.3", body.openapi === "3.0.3");
  const ops = ["/api/v1/gas", "/api/v1/balance", "/api/v1/faucets"];
  for (const p of ops) {
    const op = body.paths?.[p]?.get;
    check(`openapi ${p}: x-payment-info present`, !!op?.["x-payment-info"]);
    check(`openapi ${p}: x-payment-info payTo agent`, op?.["x-payment-info"]?.payTo === PAY_TO);
    check(`openapi ${p}: x-payment-info amount 1000`, op?.["x-payment-info"]?.amount === "1000");
    check(`openapi ${p}: 402 response declared`, !!op?.responses?.["402"]);
    check(`openapi ${p}: 200 response declared`, !!op?.responses?.["200"]);
  }
  const standalone = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
  check("openapi.json file matches served doc", eq(standalone, body));
}
{
  const res = await req("/nope");
  check("unknown route: status 404", res.status === 404, `(got ${res.status})`);
}
{
  const res = await req("/api/v1/gas?chain=sepolia", { method: "POST" });
  check("POST /v1/gas: status 404", res.status === 404, `(got ${res.status})`);
}

// 5. Invalid payment header -> 400 (no facilitator call, no funds).
{
  const res = await req("/api/v1/gas?chain=sepolia", { headers: { "PAYMENT-SIGNATURE": "!!!not-base64-json!!!" } });
  const body = await res.json();
  check("garbage PAYMENT-SIGNATURE: status 400", res.status === 400, `(got ${res.status})`);
  check("garbage PAYMENT-SIGNATURE: error Invalid payment", body.error === "Invalid payment");
}

// 6. Dummy payment payload -> facilitator /verify must reject (isValid:false).
//    Proves the verify path + facilitator reachability. No real payment:
//    the payload is garbage, so nothing can settle and no funds move.
{
  const dummy = Buffer.from(JSON.stringify({
    x402Version: 2,
    payload: { signature: "0x" + "00".repeat(65), authorization: { from: "0x0000000000000000000000000000000000000000", to: PAY_TO, value: "1000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "00".repeat(32) } },
  })).toString("base64");
  const res = await req("/api/v1/faucets?chain=sepolia", { headers: { "PAYMENT-SIGNATURE": dummy } });
  const body = await res.json();
  check("dummy payment: status 402 (verification failed)", res.status === 402, `(got ${res.status})`);
  check("dummy payment: error is verification failure", body.error === "Payment verification failed", `(got ${JSON.stringify(body).slice(0, 120)})`);
}

console.log(`\n${passed} passed, ${failed} failed.`);
if (failures.length) { console.log("Failures:", failures.join(", ")); process.exit(1); }
