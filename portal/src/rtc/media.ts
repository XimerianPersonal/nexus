export type StreamHandler = (stream: MediaStream | null) => void;

export class RemoteMediaManager {
  private stream: MediaStream | null = null;
  private handlers: Set<StreamHandler> = new Set();

  setStream(stream: MediaStream): void {
    this.stream = stream;
    this.handlers.forEach((h) => h(stream));
  }

  clearStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
    this.handlers.forEach((h) => h(null));
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  onStreamChange(handler: StreamHandler): () => void {
    this.handlers.add(handler);
    // Immediately fire with current stream if any
    if (this.stream) handler(this.stream);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
