// server.js — zero-dependency static server for local development.
// Production stays on static hosting (Netlify). Usage: `npm start`
// then open http://localhost:8080 (override with PORT=3000 npm start).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Always fresh (app shell + service worker update correctly).
const NO_STORE = new Set(["/index.html", "/sw.js", "/manifest.webmanifest"]);

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
    return;
  }
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath.slice(1)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
    headers["Cache-Control"] = NO_STORE.has(urlPath) ? "no-store" : "public, max-age=86400";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

server.on("error", (err) => {
  if (err && (err.code === "EACCES" || err.code === "EADDRINUSE")) {
    console.error(`Port ${PORT} is unavailable (${err.code}). Retry with another port, e.g.:`);
    console.error(`  PORT=8910 npm start`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => console.log(`Expense Manager dev server: http://localhost:${PORT}`));
