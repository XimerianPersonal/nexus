import type {
  ClientMessage,
  ServerMessage,
} from '../../../packages/shared/src';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
} from '../../../packages/shared/src';

export type WSEventHandler = (msg: ServerMessage) => void;
export type WSStateHandler = (state: WSState) => void;

export type WSState = 'connecting' | 'connected' | 'disconnected' | 'error';

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<WSEventHandler> = new Set();
  private stateHandlers: Set<WSStateHandler> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private _state: WSState = 'disconnected';
  private shouldReconnect = true;

  constructor(url: string) {
    this.url = url;
  }

  get state(): WSState {
    return this._state;
  }

  private setState(state: WSState) {
    this._state = state;
    this.stateHandlers.forEach((h) => h(state));
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.shouldReconnect = true;
    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.setState('error');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.startHeartbeat();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data);
        if (msg.type === 'heartbeat_ack') {
          this.clearHeartbeatTimeout();
          return;
        }
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setState('disconnected');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.setState('error');
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: WSEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStateChange(handler: WSStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat' });
      this.heartbeatTimeout = setTimeout(() => {
        // Server didn't respond, force close
        this.ws?.close();
      }, WS_HEARTBEAT_TIMEOUT_MS);
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

let clientInstance: WebSocketClient | null = null;

export function getWSClient(): WebSocketClient {
  if (!clientInstance) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws`;
    clientInstance = new WebSocketClient(url);
  }
  return clientInstance;
}
