// WebTransport connection manager for browser clients.

export interface ControlMessage {
  type: string;
  [key: string]: unknown;
}

export class WebTransportManager {
  private transport: WebTransport | null = null;
  private controlWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private controlReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  private datagramCallbacks: Array<(data: Uint8Array) => void> = [];
  private controlCallbacks: Array<(msg: ControlMessage) => void> = [];
  private closeCallbacks: Array<(reason: string) => void> = [];

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private lastUrl = '';
  private lastToken = '';
  private lastCertHash?: string;

  get isConnected(): boolean {
    return this.transport !== null;
  }

  async connect(url: string, token: string, certHash?: string): Promise<void> {
    this.lastUrl = url;
    this.lastToken = token;
    this.lastCertHash = certHash;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    await this.establishConnection(url, token, certHash);
  }

  private async establishConnection(url: string, token: string, certHash?: string): Promise<void> {
    try {
      // When a cert hash is provided (self-signed cert), pass it to the
      // WebTransport constructor so the browser trusts the server.
      const options: WebTransportOptions | undefined = certHash
        ? {
            serverCertificateHashes: [
              {
                algorithm: 'sha-256',
                value: Uint8Array.from(atob(certHash), (c) => c.charCodeAt(0)),
              },
            ],
          }
        : undefined;

      this.transport = new WebTransport(url, options);
      await this.transport.ready;

      // Send auth on first bidirectional stream
      const controlStream = await this.transport.createBidirectionalStream();
      this.controlWriter = controlStream.writable.getWriter();
      this.controlReader = controlStream.readable.getReader();

      // Send auth token as first control message
      await this.sendControl({ type: 'auth', token });

      this.reconnectAttempts = 0;

      // Start reading datagrams and control messages
      this.readDatagrams();
      this.readControl();

      // Handle connection close
      this.transport.closed
        .then(() => {
          this.handleClose('Connection closed gracefully');
        })
        .catch((err: Error) => {
          this.handleClose(err.message || 'Connection lost');
        });
    } catch (err) {
      this.transport = null;
      const msg = err instanceof Error ? err.message : 'Unknown connection error';
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      } else {
        this.closeCallbacks.forEach((cb) => cb(msg));
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.controlWriter) {
      try { this.controlWriter.releaseLock(); } catch { /* ignore */ }
      this.controlWriter = null;
    }
    if (this.controlReader) {
      try { this.controlReader.releaseLock(); } catch { /* ignore */ }
      this.controlReader = null;
    }
    if (this.transport) {
      try {
        this.transport.close({ closeCode: 0, reason: 'Client disconnect' });
      } catch { /* already closed */ }
      this.transport = null;
    }
  }

  sendDatagram(data: Uint8Array): void {
    if (!this.transport) return;
    const writer = this.transport.datagrams.writable.getWriter();
    writer.write(data).finally(() => writer.releaseLock());
  }

  onDatagram(cb: (data: Uint8Array) => void): void {
    this.datagramCallbacks.push(cb);
  }

  async sendControl(msg: ControlMessage): Promise<void> {
    if (!this.controlWriter) return;
    const encoded = new TextEncoder().encode(JSON.stringify(msg) + '\n');
    await this.controlWriter.write(encoded);
  }

  onControl(cb: (msg: ControlMessage) => void): void {
    this.controlCallbacks.push(cb);
  }

  onClose(cb: (reason: string) => void): void {
    this.closeCallbacks.push(cb);
  }

  private async readDatagrams(): Promise<void> {
    if (!this.transport) return;
    const reader = this.transport.datagrams.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          for (const cb of this.datagramCallbacks) {
            cb(value);
          }
        }
      }
    } catch {
      // Stream closed
    } finally {
      reader.releaseLock();
    }
  }

  private async readControl(): Promise<void> {
    if (!this.controlReader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await this.controlReader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          // Process newline-delimited JSON messages
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (line.length === 0) continue;
            try {
              const msg = JSON.parse(line) as ControlMessage;
              for (const cb of this.controlCallbacks) {
                cb(msg);
              }
            } catch {
              // Skip malformed messages
            }
          }
        }
      }
    } catch {
      // Stream closed
    }
  }

  private handleClose(reason: string): void {
    this.transport = null;
    this.controlWriter = null;
    this.controlReader = null;

    if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      for (const cb of this.closeCallbacks) {
        cb(reason);
      }
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    // Exponential backoff: 500ms, 1s, 2s, 4s... capped at 30s
    const delayMs = Math.min(500 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.establishConnection(this.lastUrl, this.lastToken, this.lastCertHash);
      } catch {
        // establishConnection handles retry scheduling internally
      }
    }, delayMs);
  }
}
