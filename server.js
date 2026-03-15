/*
  TEACHING: How a Web Server Works

  When you type a URL in your browser, here's what happens:
  1. Browser sends an HTTP REQUEST to the server (e.g., "GET /style.css")
  2. Server receives the request and figures out which FILE to send back
  3. Server reads the file from disk
  4. Server sends an HTTP RESPONSE with:
     - A status code (200 = OK, 404 = not found)
     - A Content-Type header (tells the browser HOW to interpret the data)
     - The file contents

  That's it! This ~30-line file does EXACTLY what nginx, Apache, and every
  other web server does — just at its most basic level.

  We use ONLY built-in Node.js modules (http, fs, path) — zero npm packages needed.
*/

const http = require('http');
const fs = require('fs');
const path = require('path');

// Railway provides the PORT via environment variable. Fallback to 3000 for local dev.
const PORT = process.env.PORT || 3000;

/*
  TEACHING: MIME Types

  When the server sends a file, it MUST tell the browser what kind of file it is.
  Without Content-Type, the browser might try to display CSS as plain text,
  or refuse to run JavaScript. This map translates file extensions to MIME types.
*/
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Strip query strings (e.g., "/style.css?v=1" → "/style.css")
  // Railway health checks and browsers may add query params
  const urlPath = req.url.split('?')[0];

  // Map "/" to "/index.html" — this is why you don't need to type "index.html" in URLs
  let filePath = urlPath === '/' ? '/index.html' : urlPath;

  // Security: prevent directory traversal attacks (e.g., "/../../../etc/passwd")
  // path.normalize removes ".." segments, then we ensure the result stays within __dirname
  filePath = path.normalize(filePath);
  const fullPath = path.join(__dirname, filePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Determine the Content-Type from the file extension
  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Read the file and send it back
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

/*
  TEACHING: Binding to 0.0.0.0

  By default, some environments only listen on "localhost" (127.0.0.1),
  which means ONLY the same machine can connect. Railway runs your app
  inside a container and routes traffic through a reverse proxy — that
  proxy is technically a "different machine," so it needs 0.0.0.0
  (listen on ALL network interfaces) to reach your server.

  This is the #1 cause of 502 errors on Railway, Render, Fly, etc.
*/
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Rock Paper Scissors server running on port ${PORT}`);
});
