import { useEffect, useRef, useState, useCallback } from 'react';
import type { ServerMessage, ClientMessage } from '../../../packages/shared/src';
import { WebSocketClient, getWSClient, type WSState } from '../api/ws';

export function useWebSocket() {
  const clientRef = useRef<WebSocketClient>(getWSClient());
  const [state, setState] = useState<WSState>(clientRef.current.state);

  useEffect(() => {
    const client = clientRef.current;
    client.connect();

    const unsub = client.onStateChange((s) => setState(s));

    return () => {
      unsub();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    clientRef.current.send(msg);
  }, []);

  const subscribe = useCallback(
    (handler: (msg: ServerMessage) => void) => {
      return clientRef.current.onMessage(handler);
    },
    [],
  );

  return { state, send, subscribe, client: clientRef.current };
}
