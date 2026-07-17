const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const INDEX_PATH = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Active admin session tracking in memory
let activeSession = {
  sessionId: null,
  deviceName: null,
  ip: null,
  lastSeen: 0
};

// Session timeout duration: 12 seconds
const SESSION_TIMEOUT = 12000;

const server = http.createServer((req, res) => {
  const url = req.url;
  const method = req.method;

  // 1. API Endpoint: Session Check (Login & Heartbeat)
  if (url === '/api/session-check' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { username, deviceName, sessionId } = JSON.parse(body);
        const now = Date.now();
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        // Check if another session is currently active
        const isAnotherSessionActive = activeSession.sessionId && 
                                       activeSession.sessionId !== sessionId && 
                                       (now - activeSession.lastSeen < SESSION_TIMEOUT);

        if (isAnotherSessionActive) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            status: 'conflict', 
            deviceName: activeSession.deviceName,
            ip: activeSession.ip 
          }));
        } else {
          // Register or refresh the current session
          activeSession.sessionId = sessionId;
          activeSession.deviceName = deviceName;
          activeSession.ip = clientIp;
          activeSession.lastSeen = now;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 2. API Endpoint: Session Heartbeat
  if (url === '/api/session-heartbeat' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sessionId, deviceName } = JSON.parse(body);
        const now = Date.now();

        if (activeSession.sessionId === sessionId) {
          activeSession.lastSeen = now;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          // If the session was taken over or expired
          const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          const isAnotherSessionActive = activeSession.sessionId && 
                                         (now - activeSession.lastSeen < SESSION_TIMEOUT);

          if (isAnotherSessionActive) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              status: 'expired_conflict', 
              deviceName: activeSession.deviceName,
              ip: activeSession.ip
            }));
          } else {
            // Re-register if empty
            activeSession.sessionId = sessionId;
            activeSession.deviceName = deviceName;
            activeSession.ip = clientIp;
            activeSession.lastSeen = now;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          }
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error' }));
      }
    });
    return;
  }

  // 3. API Endpoint: Logout
  if (url === '/api/session-logout' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sessionId } = JSON.parse(body);
        if (activeSession.sessionId === sessionId) {
          activeSession.sessionId = null;
          activeSession.deviceName = null;
          activeSession.ip = null;
          activeSession.lastSeen = 0;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error' }));
      }
    });
    return;
  }

  // 4. API Endpoint: Save Content to Disk
  if (url === '/api/save-content' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sessionId, htmlContent } = JSON.parse(body);

        // Verify session authorization
        const now = Date.now();
        const isAuthorized = activeSession.sessionId === sessionId && 
                             (now - activeSession.lastSeen < SESSION_TIMEOUT);

        if (!isAuthorized) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unauthorized', message: 'Session expired or not authorized' }));
          return;
        }

        // Read index.html from disk
        fs.readFile(INDEX_PATH, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Failed to read index.html' }));
            return;
          }

          const startMarker = '<!-- START CONTENT CONTAINER -->';
          const endMarker = '<!-- END CONTENT CONTAINER -->';

          const startIndex = data.indexOf(startMarker);
          const endIndex = data.indexOf(endMarker);

          if (startIndex === -1 || endIndex === -1) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'HTML boundary markers not found' }));
            return;
          }

          // Replace container contents
          const updatedHtml = data.substring(0, startIndex + startMarker.length) + 
                              '\n' + htmlContent + '\n' + 
                              data.substring(endIndex);

          // Write updated index.html back to disk
          fs.writeFile(INDEX_PATH, updatedHtml, 'utf8', (writeErr) => {
            if (writeErr) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'error', message: 'Failed to write index.html' }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          });
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Bad request' }));
      }
    });
    return;
  }

  // 5. Serve Static files (index.html, assets/*)
  let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);

  // Validate that the request does not escape the current folder structure
  const relative = path.relative(__dirname, filePath);
  const isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

  if (url !== '/' && !isSafe) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code} ..\n`);
      }
    } else {
      const headers = { 'Content-Type': contentType };
      if (url === '/' || url === '/index.html') {
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private';
      }
      res.writeHead(200, headers);
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop the server.`);
});
