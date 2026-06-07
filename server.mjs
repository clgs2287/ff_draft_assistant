import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.argv[2] || process.env.PORT || "5179", 10);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml"
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let filePath = path.join(root, decodeURIComponent(url.pathname));

    if (url.pathname === "/") filePath = path.join(root, "index.html");
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, host, () => {
    console.log(`Ward19 Draft Assistant: http://${host}:${port}`);
  });
