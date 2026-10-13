const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const AimGame = require('./aim_game');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('403');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocketServer({ server });

function broadcast(data, excludeWs = null) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

const game = new AimGame(broadcast);

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).substring(2, 9);
  let playerInfo = null;

  const send = (msg) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  ws.on('message', (messageRaw) => {
    try {
      const msg = JSON.parse(messageRaw);

      switch (msg.type) {
        case 'join': {
          playerInfo = game.addPlayer(playerId, msg.name, msg.color);
          send({
            type: 'init_state',
            playerId,
            player: playerInfo,
            snapshot: game.getSnapshot()
          });

          broadcast({
            type: 'player_joined',
            player: playerInfo,
            players: game.getPlayersList()
          }, ws);
          break;
        }

        case 'start_game': {
          if (!playerInfo) return;
          const res = game.startGame(playerId);
          if (!res.success) {
            send({ type: 'error', message: res.reason });
          }
          break;
        }

        case 'cursor_move': {
          if (!playerInfo) return;
          game.updatePlayerCursor(playerId, msg.x, msg.y);
          broadcast({
            type: 'cursor_update',
            playerId,
            x: msg.x,
            y: msg.y
          }, ws);
          break;
        }

        case 'shoot': {
          if (!playerInfo) return;
          game.handleShoot(playerId, msg.targetId, msg.clientTimestamp, msg.expectedVersion);
          break;
        }

        case 'miss': {
          if (!playerInfo) return;
          game.handleMiss(playerId);
          break;
        }

        case 'sync_offline_shots': {
          if (!playerInfo) return;
          const { processed } = game.syncOfflineShots(playerId, msg.shots || []);
          send({
            type: 'sync_completed',
            processed,
            snapshot: game.getSnapshot()
          });
          break;
        }

        case 'ping': {
          send({ type: 'pong' });
          break;
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    if (playerInfo) {
      game.removePlayer(playerId);
      broadcast({
        type: 'player_left',
        playerId,
        players: game.getPlayersList()
      });
    }
  });

  ws.on('error', () => {});
});

const shutdown = () => {
  game.saveImmediate();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
