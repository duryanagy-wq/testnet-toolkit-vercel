// Tiny Node HTTP wrapper around the Netlify edge function, for `vapi check`
// against localhost (the handler needs no Netlify deploy to run this way).
//   NODE_USE_ENV_PROXY=1 node test/serve.mjs [port]
// The proxy env lets the handler's outbound fetch (facilitator + public
// RPCs) work from this VM. The server listens on localhost only.
import http from "node:http";
import handler from "../edge-functions/api.js";

const port = Number(process.argv[2] || 8787);
const server = http.createServer(async (req, res) => {
  try {
    const url = `http://localhost:${port}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(", "));
      else if (v !== undefined) headers.set(k, v);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : req,
      duplex: "half",
    });
    const out = await handler(request);
    res.writeHead(out.status, [...out.headers.entries()]);
    if (out.body) {
      for await (const chunk of out.body) res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "serve error", detail: String(e?.message || e).slice(0, 200) }));
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Testnet Toolkit Netlify port serving on http://localhost:${port}`);
});
