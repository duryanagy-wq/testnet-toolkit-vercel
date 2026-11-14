// Testnet Toolkit API — Netlify Edge Function (no dependencies, plain JS module).
//
// x402 v2 paid API: gas prices, ETH balances, and a faucet directory for the
// Sepolia and Base Sepolia testnets.
//   Price: $0.001/call (1000 atomic USDC, 6 decimals).
//   payTo: vAPI agent wallet 0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C.
//   Asset: canonical USDC on Base eip155:8453.
// Payment flow (per vAPI docs, list-your-api.md): no payment header -> 402
// with the offer in the JSON body AND the base64 PAYMENT-REQUIRED header.
// With a payment (PAYMENT-SIGNATURE header, X-PAYMENT as fallback) the
// payload is verified + settled via the Coinbase x402 facilitator
// (https://x402.org/facilitator) and the data is returned with a
// PAYMENT-RESPONSE header.
//
// Upstream: free public JSON-RPC endpoints (no key). Results are cached
// 30s; if every RPC is down the gas endpoint serves its last cached value
// (marked stale) or a clearly-marked static fallback, so the endpoint
// always answers. The 402 probe path never touches upstream at all.
//
// Deploy target: Netlify Free (dashboard import from GitHub).
// Not deployed yet — no Netlify account/site exists at port time.
// Public paths live under /api/... (declared in netlify.toml) so the
// x402 resource.url always matches the real requested URL.
// Runtime: Deno (Netlify Edge Functions). Only standard Web APIs are
// used (fetch, btoa/atob, BigInt, AbortSignal.timeout), so the code
// runs unchanged on Deno.

const PAY_TO = "0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NETWORK = "eip155:8453";
const PRICE_ATOMIC = "1000"; // $0.001 USDC (6 decimals)
const MAX_TIMEOUT_SECONDS = 120;
const FACILITATOR = "https://x402.org/facilitator";
const SERVICE_NAME = "Testnet Toolkit";
const CACHE_TTL_MS = 30_000;
const RPC_TIMEOUT_MS = 5_000;
const FACILITATOR_TIMEOUT_MS = 10_000;

const CHAINS = {
  "sepolia": {
    chainId: 11155111,
    name: "Sepolia",
    rpcs: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://1rpc.io/sepolia",
    ],
    // Static fallback only used when every RPC is down AND no cache exists.
    // Marked fallback:true in the response. Typical idle-network values.
    fallbackGas: { gasPriceGwei: "0.001", maxFeePerGasGwei: "0.002", maxPriorityFeePerGasGwei: "0.001" },
  },
  "base-sepolia": {
    chainId: 84532,
    name: "Base Sepolia",
    rpcs: [
      "https://sepolia.base.org",
      "https://base-sepolia-rpc.publicnode.com",
      "https://base-sepolia.drpc.org",
    ],
    fallbackGas: { gasPriceGwei: "0.006", maxFeePerGasGwei: "0.01", maxPriorityFeePerGasGwei: "0.005" },
  },
};

// Static faucet directory — verified from daily farming runs (Nov 2026).
// Amounts are what the faucets state; requirements are from our own use.
const FAUCETS = {
  "sepolia": [
    {
      name: "Google Cloud Web3 Faucet",
      url: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
      amount: "0.05 Sepolia ETH",
      cooldown: "24h",
      notes: "Requires a Google account. Displayed cooldown is Pacific Time; each failed attempt adds ~1h.",
    },
    {
      name: "thirdweb Faucet",
      url: "https://thirdweb.com/faucet",
      amount: "0.01 Sepolia ETH",
      cooldown: "24h",
      notes: "Faucet can be empty at times; the 'Refill Faucet' button is a donation, do not press it.",
    },
    {
      name: "Chainlink Faucet",
      url: "https://faucets.chain.link/sepolia",
      amount: null,
      cooldown: "24h",
      notes: "Requires >=1 LINK on Ethereum Mainnet to claim. Multiple assets (ETH, LINK).",
    },
  ],
  "base-sepolia": [
    {
      name: "Superchain Faucet",
      url: "https://console.optimism.io",
      amount: "0.01 Base Sepolia ETH",
      cooldown: "24h",
      notes: "Requires a GitHub account + reCAPTCHA.",
    },
    {
      name: "thirdweb Faucet",
      url: "https://thirdweb.com/faucet",
      amount: "0.01 Base Sepolia ETH",
      cooldown: "24h",
      notes: "Faucet can be empty at times; the 'Refill Faucet' button is a donation, do not press it.",
    },
  ],
};

// ---- in-memory cache (per isolate; 30s TTL) ----
const cache = new Map(); // key -> { at, value }
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return e.value;
}
function cacheGetStale(key) {
  const e = cache.get(key);
  return e ? e.value : null;
}
function cacheSet(key, value) {
  cache.set(key, { at: Date.now(), value });
}

// ---- helpers ----
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function accepts() {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: PRICE_ATOMIC,
    asset: USDC_BASE,
    payTo: PAY_TO,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: { name: "USD Coin", version: "2" },
  };
}

function offerFor(request, description) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: request.url,
      description,
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
    },
    accepts: [accepts()],
  };
}

function paymentRequired(request, description) {
  const offer = offerFor(request, description);
  return json(offer, 402, {
    "PAYMENT-REQUIRED": btoa(JSON.stringify(offer)),
  });
}

function weiToGweiString(weiHex) {
  const wei = BigInt(weiHex);
  const whole = wei / 1_000_000_000n;
  const frac = wei % 1_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

function weiToEthString(weiHex) {
  const wei = BigInt(weiHex);
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = wei % 1_000_000_000_000_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

// Named exports for local unit tests only; the Workers runtime ignores them.
export { weiToGweiString, weiToEthString };

async function rpcCall(rpcUrl, calls) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) {
    for (const r of data) {
      if (r.error) throw new Error(`RPC error: ${JSON.stringify(r.error).slice(0, 120)}`);
      if (r.result === undefined) throw new Error("RPC missing result");
    }
    return data.map((r) => r.result);
  }
  if (data.error) throw new Error(`RPC error: ${JSON.stringify(data.error).slice(0, 120)}`);
  return [data.result];
}

async function rpcFirst(chainKey, calls) {
  const chain = CHAINS[chainKey];
  let lastErr = null;
  for (const rpc of chain.rpcs) {
    try {
      return { results: await rpcCall(rpc, calls), rpc };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No RPC available");
}

// ---- paid handlers (run only after payment verified + settled) ----
async function handleGas(chainKey) {
  const chain = CHAINS[chainKey];
  const key = `gas:${chainKey}`;
  const cached = cacheGet(key);
  if (cached) return json({ ...cached, cached: true });
  try {
    const { results, rpc } = await rpcFirst(chainKey, [
      { jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_feeHistory", params: ["0x1", "latest", [50]] },
      { jsonrpc: "2.0", id: 3, method: "eth_blockNumber", params: [] },
    ]);
    const gasPriceWei = BigInt(results[0]);
    const feeHistory = results[1];
    const baseFeeWei = BigInt(feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]);
    const priorityWei = feeHistory.reward && feeHistory.reward[0] && feeHistory.reward[0][0]
      ? BigInt(feeHistory.reward[0][0])
      : 0n;
    // Standard next-block maxFee estimate: 2x base fee + priority fee.
    const maxFeeWei = baseFeeWei * 2n + priorityWei;
    const value = {
      chain: chainKey,
      chainId: chain.chainId,
      gasPriceGwei: weiToGweiString(results[0]),
      maxFeePerGasGwei: weiToGweiString("0x" + maxFeeWei.toString(16)),
      maxPriorityFeePerGasGwei: weiToGweiString("0x" + priorityWei.toString(16)),
      blockNumber: parseInt(results[2], 16),
      source: rpc,
      cachedAt: new Date().toISOString(),
    };
    cacheSet(key, value);
    return json(value);
  } catch (e) {
    const stale = cacheGetStale(key);
    if (stale) return json({ ...stale, stale: true });
    return json({
      chain: chainKey,
      chainId: chain.chainId,
      ...chain.fallbackGas,
      blockNumber: null,
      source: "static-fallback",
      fallback: true,
      cachedAt: new Date().toISOString(),
      note: "Upstream RPCs unreachable; static fallback values.",
    });
  }
}

async function handleBalance(chainKey, address) {
  const chain = CHAINS[chainKey];
  const key = `balance:${chainKey}:${address.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return json({ ...cached, cached: true });
  try {
    const { results, rpc } = await rpcFirst(chainKey, [
      { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]);
    const value = {
      chain: chainKey,
      chainId: chain.chainId,
      address,
      balanceWei: BigInt(results[0]).toString(10),
      balanceEth: weiToEthString(results[0]),
      blockNumber: parseInt(results[1], 16),
      source: rpc,
      cachedAt: new Date().toISOString(),
    };
    cacheSet(key, value);
    return json(value);
  } catch (e) {
    const stale = cacheGetStale(key);
    if (stale) return json({ ...stale, stale: true });
    return json({
      error: "Upstream RPC unavailable",
      chain: chainKey,
      address,
      detail: "All public RPCs failed and no cached value exists. Try again shortly.",
    }, 502);
  }
}

function handleFaucets(chainKey) {
  return json({
    chain: chainKey,
    faucets: FAUCETS[chainKey],
    updatedAt: "2026-11-14",
  });
}

// ---- payment (x402 v2, per vAPI docs) ----
async function verifyAndSettle(paymentPayload) {
  const body = JSON.stringify({
    x402Version: 2,
    paymentPayload,
    paymentRequirements: accepts(),
  });
  const headers = { "content-type": "application/json" };
  const verifyRes = await fetch(`${FACILITATOR}/verify`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
  });
  const verified = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok || !verified.isValid) {
    return { ok: false, error: "Payment verification failed" };
  }
  const settleRes = await fetch(`${FACILITATOR}/settle`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
  });
  const settlement = await settleRes.json().catch(() => ({}));
  if (!settleRes.ok || !settlement.success) {
    return { ok: false, error: "Payment settlement failed" };
  }
  return { ok: true, settlement };
}

// ---- router ----
const handler = {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      // CORS preflight.
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(),
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      // Free info endpoints (no payment).
      if (url.pathname === "/api" && request.method === "GET") {
        return json({
          service: SERVICE_NAME,
          version: "1.0.0",
          description: "Gas prices, balances, and faucet directory for Sepolia and Base Sepolia testnets.",
          price: "$0.001/call (USDC on Base)",
          endpoints: ["/api/v1/gas?chain=sepolia|base-sepolia", "/api/v1/balance?chain=...&address=0x...", "/api/v1/faucets?chain=sepolia|base-sepolia"],
          openapi: "/api/openapi.json",
        });
      }
      if (url.pathname === "/api/openapi.json" && request.method === "GET") {
        return json(OPENAPI);
      }

      // Paid operations.
      const paid = {
        "/api/v1/gas": "Testnet gas prices (Sepolia / Base Sepolia).",
        "/api/v1/balance": "ETH balance for an address (Sepolia / Base Sepolia).",
        "/api/v1/faucets": "Testnet faucet directory (Sepolia / Base Sepolia).",
      };
      const description = paid[url.pathname];
      if (!description || request.method !== "GET") {
        return json({ error: "Not found", hint: "See GET /api for the endpoint list." }, 404);
      }

      // Validate params BEFORE payment (cheap, clear errors).
      const chainKey = url.searchParams.get("chain");
      if (!chainKey || !CHAINS[chainKey]) {
        return json({
          error: "Invalid or missing chain parameter",
          supportedChains: Object.keys(CHAINS),
        }, 400);
      }
      let address = null;
      if (url.pathname === "/api/v1/balance") {
        address = url.searchParams.get("address");
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
          return json({ error: "Invalid or missing address parameter (expected 0x + 40 hex chars)" }, 400);
        }
      }

      // Payment gate.
      const paymentHeader =
        request.headers.get("PAYMENT-SIGNATURE") || request.headers.get("X-PAYMENT");
      if (!paymentHeader) {
        return paymentRequired(request, description);
      }
      let paymentPayload;
      try {
        paymentPayload = JSON.parse(atob(paymentHeader));
      } catch {
        return json({ error: "Invalid payment" }, 400);
      }
      const paidResult = await verifyAndSettle(paymentPayload);
      if (!paidResult.ok) {
        return json({ error: paidResult.error }, 402);
      }
      const paymentResponse = btoa(JSON.stringify(paidResult.settlement));

      // Serve the data, attaching the payment receipt.
      let res;
      if (url.pathname === "/api/v1/gas") res = await handleGas(chainKey);
      else if (url.pathname === "/api/v1/balance") res = await handleBalance(chainKey, address);
      else res = handleFaucets(chainKey);
      const headers = new Headers(res.headers);
      headers.set("PAYMENT-RESPONSE", paymentResponse);
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      return json({ error: "Internal error", detail: String(e && e.message ? e.message : e).slice(0, 200) }, 500);
    }
  },
};

// Netlify Edge Functions expect a default-exported function
// (request, context) => Response. The context argument is unused.
export default (request) => handler.fetch(request);

// OpenAPI 3.0.3 — served at /api/openapi.json. The servers URL is a
// placeholder and MUST be replaced with the real deployed Netlify URL
// before publish (site name chosen at import time).
const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "Testnet Toolkit",
    version: "1.0.0",
    description: "Gas prices, balances, and faucet directory for Sepolia and Base Sepolia testnets. Paid $0.001/call in USDC on Base (x402 v2).",
  },
  servers: [{ url: "https://rococo-haupia-20e86a.netlify.app", description: "Placeholder — replace with the deployed Netlify URL before publish." }],
  paths: {
    "/api/v1/gas": {
      get: {
        summary: "Testnet gas prices",
        description: "Current gas price, max fee estimate, and block number for Sepolia or Base Sepolia.",
        operationId: "getGas",
        parameters: [
          { name: "chain", in: "query", required: true, schema: { type: "string", enum: ["sepolia", "base-sepolia"] }, description: "Testnet chain id." },
        ],
        "x-payment-info": {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C",
          maxTimeoutSeconds: 120,
          extra: { name: "USD Coin", version: "2" },
        },
        responses: {
          200: { description: "Gas data.", content: { "application/json": { schema: { type: "object", properties: { chain: { type: "string" }, chainId: { type: "integer" }, gasPriceGwei: { type: "string" }, maxFeePerGasGwei: { type: "string" }, maxPriorityFeePerGasGwei: { type: "string" }, blockNumber: { type: "integer", nullable: true } } } } } },
          400: { description: "Invalid or missing chain parameter." },
          402: { description: "Payment required (x402 v2)." },
          502: { description: "Upstream RPC unavailable." },
        },
      },
    },
    "/api/v1/balance": {
      get: {
        summary: "ETH balance for an address",
        description: "ETH balance (wei + ETH) for an address on Sepolia or Base Sepolia.",
        operationId: "getBalance",
        parameters: [
          { name: "chain", in: "query", required: true, schema: { type: "string", enum: ["sepolia", "base-sepolia"] }, description: "Testnet chain id." },
          { name: "address", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "EVM address (0x + 40 hex chars)." },
        ],
        "x-payment-info": {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C",
          maxTimeoutSeconds: 120,
          extra: { name: "USD Coin", version: "2" },
        },
        responses: {
          200: { description: "Balance data.", content: { "application/json": { schema: { type: "object", properties: { chain: { type: "string" }, chainId: { type: "integer" }, address: { type: "string" }, balanceWei: { type: "string" }, balanceEth: { type: "string" }, blockNumber: { type: "integer" } } } } } },
          400: { description: "Invalid chain or address parameter." },
          402: { description: "Payment required (x402 v2)." },
          502: { description: "Upstream RPC unavailable." },
        },
      },
    },
    "/api/v1/faucets": {
      get: {
        summary: "Testnet faucet directory",
        description: "Faucet list for Sepolia or Base Sepolia: name, URL, amount, cooldown, requirements.",
        operationId: "getFaucets",
        parameters: [
          { name: "chain", in: "query", required: true, schema: { type: "string", enum: ["sepolia", "base-sepolia"] }, description: "Testnet chain id." },
        ],
        "x-payment-info": {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x803C50DDE8899168e8443aea9CA82a6Fe693Fd7C",
          maxTimeoutSeconds: 120,
          extra: { name: "USD Coin", version: "2" },
        },
        responses: {
          200: { description: "Faucet directory.", content: { "application/json": { schema: { type: "object", properties: { chain: { type: "string" }, faucets: { type: "array", items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, amount: { type: "string", nullable: true }, cooldown: { type: "string" }, notes: { type: "string" } } } } } } } } },
          400: { description: "Invalid or missing chain parameter." },
          402: { description: "Payment required (x402 v2)." },
        },
      },
    },
  },
};
