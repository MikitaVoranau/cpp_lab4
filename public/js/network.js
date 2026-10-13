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
      this.emit('network_status', { online: true });
      if (!this.isSimulatingOffline && !this.isConnected) {
        this.connect();
      }
    });

    window.addEventListener('offline', () => {
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
        } catch {}
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('disconnected');

        if (!this.isSimulatingOffline && navigator.onLine) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {};
    } catch {
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
      this.send({
        type: 'sync_offline_shots',
        shots: queue
      });
      window.clientStorage.clearOfflineQueue();
      this.emit('offline_queue_flushed', { count: queue.length });
    }
  }

  handleIncoming(msg) {
    this.emit(msg.type, msg);
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
