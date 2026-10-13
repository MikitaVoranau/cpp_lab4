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
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// --- HTTP СЕРВЕР (БЕЗ ФРЕЙМВОРКОВ) ---
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end('403 Доступ запрещен');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404 Файл не найден');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// --- WEBSOCKET СЕРВЕР ---
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

          console.log(`[WS] Стрелок ${playerInfo.name} присоединился к арене`);
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
          const result = game.handleShoot(playerId, msg.targetId, msg.clientTimestamp, msg.expectedVersion);
          if (result && !result.success && result.conflict) {
            send({
              type: 'conflict_feedback',
              message: result.reason
            });
          }
          break;
        }

        case 'miss': {
          if (!playerInfo) return;
          game.handleMiss(playerId);
          break;
        }

        case 'sync_offline_shots': {
          if (!playerInfo) return;
          const { processed, conflicts } = game.syncOfflineShots(playerId, msg.shots || []);
          send({
            type: 'sync_completed',
            processed,
            conflicts,
            snapshot: game.getSnapshot()
          });
          break;
        }

        case 'chat': {
          if (!playerInfo) return;
          const chatMsg = game.addChatMessage(playerId, playerInfo.name, msg.text);
          broadcast({
            type: 'chat_message',
            message: chatMsg
          });
          break;
        }

        case 'ping': {
          send({ type: 'pong', timestamp: Date.now() });
          break;
        }

        default:
          console.warn('[WS] Неизвестное сообщение:', msg.type);
      }
    } catch (err) {
      console.error('[WS Error]', err);
    }
  });

  ws.on('close', () => {
    if (playerInfo) {
      console.log(`[WS] Стрелок ${playerInfo.name} покинул арену`);
      game.removePlayer(playerId);
      broadcast({
        type: 'player_left',
        playerId,
        players: game.getPlayersList()
      });
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Error] Клиент ${playerId}:`, err.message);
  });
});

const shutdown = () => {
  console.log('\n[Server] Завершение работы, сохранение рекордов Aim Arena...');
  game.saveImmediate();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🎯 Сервер сетевого Aim Arena (Aim Lab) запущен!`);
  console.log(`🌐 Адрес: http://localhost:${PORT}`);
  console.log(`🔌 WebSockets: ws://localhost:${PORT}`);
  console.log(`===================================================`);
});
