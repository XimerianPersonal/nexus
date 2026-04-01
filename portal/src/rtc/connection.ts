import type { RTCSignal, SignalMessage } from '../../../packages/shared/src';
import { ICE_SERVERS } from '../../../packages/shared/src';
import { WebSocketClient } from '../api/ws';

export type ConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export type ConnectionStateHandler = (state: ConnectionState) => void;
export type TrackHandler = (stream: MediaStream) => void;
export type DataChannelHandler = (channel: RTCDataChannel) => void;

export class PeerConnectionManager {
  private pc: RTCPeerConnection;
  private ws: WebSocketClient;
  private sessionCode: string;
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private trackHandlers: Set<TrackHandler> = new Set();
  private dataChannelHandlers: Set<DataChannelHandler> = new Set();
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private hasRemoteDescription = false;

  constructor(ws: WebSocketClient, sessionCode: string) {
    this.ws = ws;
    this.sessionCode = sessionCode;

    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const signal: RTCSignal = {
          kind: 'ice_candidate',
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid ?? undefined,
          sdpMLineIndex: ev.candidate.sdpMLineIndex ?? undefined,
        };
        this.ws.send({
          type: 'signal',
          sessionCode: this.sessionCode,
          signal,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState as ConnectionState;
      this.stateHandlers.forEach((h) => h(state));
    };

    this.pc.ontrack = (ev) => {
      if (ev.streams[0]) {
        this.trackHandlers.forEach((h) => h(ev.streams[0]));
      }
    };

    this.pc.ondatachannel = (ev) => {
      this.dataChannelHandlers.forEach((h) => h(ev.channel));
    };

    // Add transceivers so we can receive video/audio from the agent
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.pc.addTransceiver('audio', { direction: 'recvonly' });
  }

  get connectionState(): ConnectionState {
    return this.pc.connectionState as ConnectionState;
  }

  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  onTrack(handler: TrackHandler): () => void {
    this.trackHandlers.add(handler);
    return () => {
      this.trackHandlers.delete(handler);
    };
  }

  onDataChannel(handler: DataChannelHandler): () => void {
    this.dataChannelHandlers.add(handler);
    return () => {
      this.dataChannelHandlers.delete(handler);
    };
  }

  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.ws.send({
      type: 'signal',
      sessionCode: this.sessionCode,
      signal: {
        kind: 'offer',
        sdp: offer.sdp!,
      },
    });
  }

  async handleSignal(msg: SignalMessage): Promise<void> {
    const { signal } = msg;

    switch (signal.kind) {
      case 'offer': {
        await this.pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }),
        );
        this.hasRemoteDescription = true;
        await this.flushPendingCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.ws.send({
          type: 'signal',
          sessionCode: this.sessionCode,
          signal: {
            kind: 'answer',
            sdp: answer.sdp!,
          },
        });
        break;
      }
      case 'answer': {
        await this.pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }),
        );
        this.hasRemoteDescription = true;
        await this.flushPendingCandidates();
        break;
      }
      case 'ice_candidate': {
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
        };
        if (this.hasRemoteDescription) {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          this.pendingIceCandidates.push(candidate);
        }
        break;
      }
    }
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    return this.pc.createDataChannel(label, options);
  }

  private async flushPendingCandidates(): Promise<void> {
    for (const candidate of this.pendingIceCandidates) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    this.pendingIceCandidates = [];
  }

  close(): void {
    this.pc.close();
    this.stateHandlers.clear();
    this.trackHandlers.clear();
    this.dataChannelHandlers.clear();
  }
}
