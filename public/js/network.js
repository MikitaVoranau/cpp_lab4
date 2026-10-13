/**
 * Сетевой менеджер Aim Lab на чистых WebSockets
 */

class NetworkManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isSimulatingOffline = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.maxReconnectDelay = 5000;
    this.listeners = new Map();

    this.initBrowserNetworkListeners();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      for (const cb of list) cb(data);
    }
  }

  initBrowserNetworkListeners() {
    window.addEventListener('online', () => {
      console.log('[Network] Сеть восстановлена');
      this.emit('network_status', { online: true });
      if (!this.isSimulatingOffline && !this.isConnected) {
        this.connect();
      }
    });

    window.addEventListener('offline', () => {
      console.log('[Network] Сеть пропала');
      this.emit('network_status', { online: false });
      if (this.ws) {
        this.ws.close();
      }
    });
  }

  connect() {
    if (this.isSimulatingOffline) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    this.emit('connecting', { attempt: this.reconnectAttempts + 1 });

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Network] WebSocket подключен!');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');

        const savedPlayer = window.clientStorage.getPlayer();
        this.send({
          type: 'join',
          name: savedPlayer.name,
          color: savedPlayer.color
        });

        this.flushOfflineQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncoming(msg);
        } catch (err) {
          console.error('[Network Error]', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('disconnected');

        if (!this.isSimulatingOffline && navigator.onLine) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Network Error]', err);
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    this.emit('reconnecting_in', { seconds: Math.round(delay / 1000) });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  send(data) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  sendShoot(targetId, expectedVersion) {
    const action = {
      type: 'shoot',
      targetId,
      expectedVersion,
      clientTimestamp: Date.now()
    };

    if (this.isConnected) {
      this.send(action);
    } else {
      // Сохранение выстрела в офлайн-очередь (Дополнительно: 8-10 баллов)
      window.clientStorage.enqueueOfflineShot(action);
      this.emit('offline_shot_queued', { action, count: window.clientStorage.getOfflineQueue().length });
    }
  }

  sendMiss() {
    if (this.isConnected) {
      this.send({ type: 'miss' });
    }
  }

  sendCursorMove(x, y) {
    if (this.isConnected) {
      this.send({ type: 'cursor_move', x, y });
    }
  }

  flushOfflineQueue() {
    const queue = window.clientStorage.getOfflineQueue();
    if (queue.length > 0) {
      console.log(`[Network] Синхронизация ${queue.length} офлайн-выстрелов...`);
      this.send({
        type: 'sync_offline_shots',
        shots: queue
      });
      window.clientStorage.clearOfflineQueue();
      this.emit('offline_queue_flushed', { count: queue.length });
    }
  }

  handleIncoming(msg) {
    switch (msg.type) {
      case 'init_state':
      case 'round_started':
      case 'round_ended':
      case 'time_sync':
      case 'target_spawned':
      case 'target_hit':
      case 'target_expired':
      case 'target_conflict':
      case 'cursor_update':
      case 'player_joined':
      case 'player_left':
      case 'player_stats_update':
      case 'chat_message':
      case 'sync_completed':
        this.emit(msg.type, msg);
        break;
      default:
        console.log('[Network] msg:', msg);
    }
  }

  toggleSimulateOffline() {
    this.isSimulatingOffline = !this.isSimulatingOffline;
    if (this.isSimulatingOffline) {
      if (this.ws) this.ws.close();
      this.isConnected = false;
      this.emit('disconnected');
    } else {
      this.connect();
    }
    return this.isSimulatingOffline;
  }
}

window.networkManager = new NetworkManager();
