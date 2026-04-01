import type {
  DataChannelMessage,
  RemoteInput,
  DCChatMessage,
  DCFileChunkMessage,
  DCFileCompleteMessage,
} from '../../../packages/shared/src';
import { MAX_FILE_CHUNK_SIZE } from '../../../packages/shared/src';

export type DCMessageHandler = (msg: DataChannelMessage) => void;
export type DCStateHandler = (state: RTCDataChannelState) => void;

export class DataChannelManager {
  private inputChannel: RTCDataChannel | null = null;
  private chatChannel: RTCDataChannel | null = null;
  private fileChannel: RTCDataChannel | null = null;
  private messageHandlers: Set<DCMessageHandler> = new Set();
  private stateHandlers: Set<DCStateHandler> = new Set();

  attachChannel(channel: RTCDataChannel): void {
    const label = channel.label;
    switch (label) {
      case 'input':
        this.inputChannel = channel;
        break;
      case 'chat':
        this.chatChannel = channel;
        break;
      case 'file':
        this.fileChannel = channel;
        break;
      default:
        return;
    }

    channel.onmessage = (ev) => {
      try {
        const msg: DataChannelMessage = JSON.parse(ev.data);
        this.messageHandlers.forEach((h) => h(msg));
      } catch {
        // ignore
      }
    };

    channel.onopen = () => {
      this.stateHandlers.forEach((h) => h('open'));
    };

    channel.onclose = () => {
      this.stateHandlers.forEach((h) => h('closed'));
    };
  }

  createChannels(
    createFn: (label: string, options?: RTCDataChannelInit) => RTCDataChannel,
  ): void {
    this.attachChannel(createFn('input', { ordered: true }));
    this.attachChannel(createFn('chat', { ordered: true }));
    this.attachChannel(createFn('file', { ordered: true, maxRetransmits: 3 }));
  }

  sendInput(input: RemoteInput): void {
    if (this.inputChannel?.readyState === 'open') {
      this.inputChannel.send(JSON.stringify({ type: 'input', input }));
    }
  }

  sendChat(text: string): void {
    const msg: DCChatMessage = {
      type: 'dc_chat',
      text,
      timestamp: Date.now(),
    };
    if (this.chatChannel?.readyState === 'open') {
      this.chatChannel.send(JSON.stringify(msg));
    }
  }

  async sendFile(
    fileId: string,
    file: File,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    if (!this.fileChannel || this.fileChannel.readyState !== 'open') {
      throw new Error('File data channel not open');
    }

    const buffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(buffer.byteLength / MAX_FILE_CHUNK_SIZE);
    let offset = 0;
    let chunkIndex = 0;

    while (offset < buffer.byteLength) {
      const end = Math.min(offset + MAX_FILE_CHUNK_SIZE, buffer.byteLength);
      const chunk = buffer.slice(offset, end);
      const b64 = btoa(
        String.fromCharCode(...new Uint8Array(chunk)),
      );

      const msg: DCFileChunkMessage = {
        type: 'file_chunk',
        fileId,
        chunkIndex,
        data: b64,
      };

      // Back-pressure: wait if bufferedAmount is too high
      while (this.fileChannel.bufferedAmount > 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 50));
      }

      this.fileChannel.send(JSON.stringify(msg));
      offset = end;
      chunkIndex++;
      onProgress?.(offset, buffer.byteLength);
    }

    // Send complete message
    const completeMsg: DCFileCompleteMessage = {
      type: 'file_complete',
      fileId,
      totalChunks,
      checksum: await computeChecksum(buffer),
    };
    this.fileChannel.send(JSON.stringify(completeMsg));
  }

  get isChatOpen(): boolean {
    return this.chatChannel?.readyState === 'open';
  }

  get isInputOpen(): boolean {
    return this.inputChannel?.readyState === 'open';
  }

  get isFileOpen(): boolean {
    return this.fileChannel?.readyState === 'open';
  }

  onMessage(handler: DCMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: DCStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    this.inputChannel?.close();
    this.chatChannel?.close();
    this.fileChannel?.close();
    this.inputChannel = null;
    this.chatChannel = null;
    this.fileChannel = null;
    this.messageHandlers.clear();
    this.stateHandlers.clear();
  }
}

async function computeChecksum(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
