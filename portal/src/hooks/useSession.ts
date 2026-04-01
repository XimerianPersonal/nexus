import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  ServerMessage,
  SignalMessage,
  RemoteInput,
  AgentInfo,
} from '../../../packages/shared/src';
import { useWebSocket } from './useWebSocket';
import {
  PeerConnectionManager,
  type ConnectionState,
} from '../rtc/connection';
import { DataChannelManager } from '../rtc/data-channel';
import { RemoteMediaManager } from '../rtc/media';

export interface ChatEntry {
  id: string;
  sender: 'self' | 'peer';
  text: string;
  timestamp: number;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  direction: 'upload' | 'download';
  progress: number; // 0-1
  complete: boolean;
  url?: string; // download URL for received files
}

export interface SessionState {
  sessionCode: string;
  wsState: 'connecting' | 'connected' | 'disconnected' | 'error';
  rtcState: ConnectionState;
  dcState: RTCDataChannelState | 'new';
  joined: boolean;
  agentInfo: AgentInfo | null;
  remoteStream: MediaStream | null;
  chatMessages: ChatEntry[];
  files: FileEntry[];
  error: string | null;
  sendChat: (text: string) => void;
  sendInput: (input: RemoteInput) => void;
  sendFile: (file: File) => void;
  disconnect: () => void;
}

export function useSession(sessionCode: string): SessionState {
  const { state: wsState, send, subscribe, client } = useWebSocket();
  const pcRef = useRef<PeerConnectionManager | null>(null);
  const dcRef = useRef<DataChannelManager | null>(null);
  const mediaRef = useRef<RemoteMediaManager>(new RemoteMediaManager());

  const [rtcState, setRtcState] = useState<ConnectionState>('new');
  const [dcState, setDcState] = useState<RTCDataChannelState | 'new'>('new');
  const [joined, setJoined] = useState(false);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // File chunk accumulation for received files
  const fileChunksRef = useRef<
    Map<string, { chunks: Map<number, string>; name: string; size: number }>
  >(new Map());

  // Join session when WS connects
  useEffect(() => {
    if (wsState !== 'connected' || joined) return;

    send({
      type: 'join_session',
      sessionCode,
      role: 'portal',
      displayName: 'Support Agent',
    });
  }, [wsState, joined, sessionCode, send]);

  // Handle WS messages
  useEffect(() => {
    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'session_joined': {
          if (msg.sessionCode === sessionCode) {
            setJoined(true);
            setupRTC();
          }
          break;
        }
        case 'peer_joined': {
          if (msg.sessionCode === sessionCode && msg.role === 'agent') {
            // Agent joined, create offer
            pcRef.current?.createOffer();
          }
          break;
        }
        case 'peer_left': {
          if (msg.sessionCode === sessionCode && msg.role === 'agent') {
            setAgentInfo(null);
            setRtcState('disconnected');
          }
          break;
        }
        case 'signal': {
          if (msg.sessionCode === sessionCode) {
            pcRef.current?.handleSignal(msg as SignalMessage);
          }
          break;
        }
        case 'chat': {
          if (msg.sessionCode === sessionCode) {
            setChatMessages((prev) => [
              ...prev,
              {
                id: `${msg.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                sender: msg.sender === 'portal' ? 'self' : 'peer',
                text: msg.text,
                timestamp: msg.timestamp,
              },
            ]);
          }
          break;
        }
        case 'file_offer': {
          if (msg.sessionCode === sessionCode) {
            fileChunksRef.current.set(msg.fileId, {
              chunks: new Map(),
              name: msg.fileName,
              size: msg.fileSize,
            });
            setFiles((prev) => [
              ...prev,
              {
                id: msg.fileId,
                name: msg.fileName,
                size: msg.fileSize,
                direction: 'download',
                progress: 0,
                complete: false,
              },
            ]);
            // Auto-accept
            send({
              type: 'file_accept',
              sessionCode,
              fileId: msg.fileId,
              accepted: true,
            });
          }
          break;
        }
        case 'error': {
          setError(msg.message);
          break;
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, sessionCode, send]);

  // Setup RTC
  const setupRTC = useCallback(() => {
    if (pcRef.current) return;

    const pc = new PeerConnectionManager(client, sessionCode);
    pcRef.current = pc;

    const dc = new DataChannelManager();
    dcRef.current = dc;

    pc.onStateChange((state) => {
      setRtcState(state);
    });

    pc.onTrack((stream) => {
      mediaRef.current.setStream(stream);
      setRemoteStream(stream);
    });

    pc.onDataChannel((channel) => {
      dc.attachChannel(channel);
    });

    dc.onStateChange((state) => {
      setDcState(state);
    });

    dc.onMessage((msg) => {
      switch (msg.type) {
        case 'dc_chat': {
          setChatMessages((prev) => [
            ...prev,
            {
              id: `${msg.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
              sender: 'peer',
              text: msg.text,
              timestamp: msg.timestamp,
            },
          ]);
          break;
        }
        case 'file_chunk': {
          const entry = fileChunksRef.current.get(msg.fileId);
          if (entry) {
            entry.chunks.set(msg.chunkIndex, msg.data);
            const received = entry.chunks.size;
            // Estimate progress based on received data
            setFiles((prev) =>
              prev.map((f) =>
                f.id === msg.fileId
                  ? { ...f, progress: Math.min(received * 65536 / entry.size, 0.99) }
                  : f,
              ),
            );
          }
          break;
        }
        case 'file_complete': {
          const entry = fileChunksRef.current.get(msg.fileId);
          if (entry) {
            // Reconstruct file from chunks
            const chunks: string[] = [];
            for (let i = 0; i < msg.totalChunks; i++) {
              const chunk = entry.chunks.get(i);
              if (chunk) chunks.push(chunk);
            }
            const binaryStr = chunks.map((b64) => atob(b64)).join('');
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            const blob = new Blob([bytes]);
            const url = URL.createObjectURL(blob);

            setFiles((prev) =>
              prev.map((f) =>
                f.id === msg.fileId
                  ? { ...f, progress: 1, complete: true, url }
                  : f,
              ),
            );
            fileChunksRef.current.delete(msg.fileId);
          }
          break;
        }
      }
    });

    // Create data channels and offer
    dc.createChannels(pc.createDataChannel.bind(pc));
    pc.createOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionCode]);

  // Fetch agent info
  useEffect(() => {
    if (rtcState === 'connected' && !agentInfo) {
      import('../api/rest').then(({ getSession }) => {
        getSession(sessionCode)
          .then((session) => {
            if (session.agentInfo) setAgentInfo(session.agentInfo);
          })
          .catch(() => {
            // ignore
          });
      });
    }
  }, [rtcState, agentInfo, sessionCode]);

  const sendChat = useCallback(
    (text: string) => {
      dcRef.current?.sendChat(text);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'self',
          text,
          timestamp: Date.now(),
        },
      ]);
    },
    [],
  );

  const sendInput = useCallback((input: RemoteInput) => {
    dcRef.current?.sendInput(input);
  }, []);

  const sendFile = useCallback(
    (file: File) => {
      const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      setFiles((prev) => [
        ...prev,
        {
          id: fileId,
          name: file.name,
          size: file.size,
          direction: 'upload',
          progress: 0,
          complete: false,
        },
      ]);

      // Notify peer via WS
      send({
        type: 'file_offer',
        sessionCode,
        fileId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || undefined,
      });

      // Send via data channel
      dcRef.current
        ?.sendFile(fileId, file, (sent, total) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, progress: sent / total } : f,
            ),
          );
        })
        .then(() => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, progress: 1, complete: true } : f,
            ),
          );
        })
        .catch(() => {
          setError(`Failed to send file: ${file.name}`);
        });
    },
    [send, sessionCode],
  );

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    mediaRef.current.clearStream();
    setRemoteStream(null);
    setRtcState('closed');
    setDcState('closed');
    client.disconnect();
  }, [client]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dcRef.current?.close();
      pcRef.current?.close();
      mediaRef.current.clearStream();
    };
  }, []);

  return {
    sessionCode,
    wsState,
    rtcState,
    dcState,
    joined,
    agentInfo,
    remoteStream,
    chatMessages,
    files,
    error,
    sendChat,
    sendInput,
    sendFile,
    disconnect,
  };
}
