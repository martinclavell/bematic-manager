import { EventEmitter } from 'events';
import WebSocket from 'ws';

/**
 * Test client for WebSocket connections with helper methods for testing
 * WebSocket-based functionality in the Bematic Manager system.
 *
 * @example
 * ```typescript
 * const client = new WebSocketTestClient();
 * await client.connect('ws://localhost:3001', 'test-api-key');
 *
 * // Send a message
 * await client.send({ type: 'test', data: 'hello' });
 *
 * // Wait for specific message type
 * const response = await client.waitForMessage('response', 5000);
 *
 * await client.disconnect();
 * ```
 */
export class WebSocketTestClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private receivedMessages: any[] = [];
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  /**
   * Connect to WebSocket server with authentication
   * @param url WebSocket server URL
   * @param apiKey API key for authentication
   * @param timeout Connection timeout in milliseconds (default: 5000)
   */
  async connect(url: string, apiKey: string, timeout = 5000): Promise<void> {
    if (this.ws && this.isConnected) {
      throw new Error('WebSocket already connected');
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
        }
        reject(new Error(`WebSocket connection timeout after ${timeout}ms`));
      }, timeout);

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'WebSocketTestClient/1.0.0'
        }
      });

      this.ws.on('open', () => {
        clearTimeout(timeoutId);
        this.isConnected = true;
        this.emit('connected');
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeoutId);
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeoutId);
        this.isConnected = false;
        this.emit('disconnected', { code, reason: reason?.toString() });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.receivedMessages.push({
            ...message,
            _timestamp: Date.now()
          });
          this.emit('message', message);
        } catch (error) {
          this.emit('parse-error', { data: data.toString(), error });
        }
      });
    });

    return this.connectionPromise;
  }

  /**
   * Disconnect from WebSocket server
   * @param timeout Disconnection timeout in milliseconds (default: 3000)
   */
  async disconnect(timeout = 3000): Promise<void> {
    if (!this.ws || !this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
        }
        reject(new Error(`WebSocket disconnection timeout after ${timeout}ms`));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timeoutId);
        this.ws = null;
        this.isConnected = false;
        this.connectionPromise = null;
        resolve();
      };

      if (this.ws) {
        this.ws.once('close', cleanup);
        this.ws.close(1000, 'Test completed');
      } else {
        cleanup();
      }
    });
  }

  /**
   * Send a message to the WebSocket server
   * @param message Message object to send
   * @throws Error if not connected
   */
  async send(message: any): Promise<void> {
    if (!this.ws || !this.isConnected) {
      throw new Error('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      try {
        const data = JSON.stringify(message);
        this.ws!.send(data, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Wait for a message of specific type
   * @param type Message type to wait for
   * @param timeout Timeout in milliseconds (default: 5000)
   * @returns Promise resolving to the matching message
   */
  async waitForMessage(type: string, timeout = 5000): Promise<any> {
    // Check if message already received
    const existingMessage = this.receivedMessages.find(msg => msg.type === type);
    if (existingMessage) {
      return existingMessage;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('message', messageHandler);
        reject(new Error(`Timeout waiting for message type '${type}' after ${timeout}ms`));
      }, timeout);

      const messageHandler = (message: any) => {
        if (message.type === type) {
          clearTimeout(timeoutId);
          this.removeListener('message', messageHandler);
          resolve(message);
        }
      };

      this.on('message', messageHandler);
    });
  }

  /**
   * Wait for WebSocket connection to be established
   * @param timeout Connection timeout in milliseconds (default: 5000)
   */
  async waitForConnection(timeout = 5000): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('connected', connectHandler);
        reject(new Error(`Timeout waiting for connection after ${timeout}ms`));
      }, timeout);

      const connectHandler = () => {
        clearTimeout(timeoutId);
        this.removeListener('connected', connectHandler);
        resolve();
      };

      this.once('connected', connectHandler);
    });
  }

  /**
   * Get all received messages
   * @returns Array of received messages with timestamps
   */
  getReceivedMessages(): any[] {
    return [...this.receivedMessages];
  }

  /**
   * Get received messages of specific type
   * @param type Message type to filter by
   * @returns Array of matching messages
   */
  getMessagesByType(type: string): any[] {
    return this.receivedMessages.filter(msg => msg.type === type);
  }

  /**
   * Clear all received messages
   */
  clearMessages(): void {
    this.receivedMessages = [];
  }

  /**
   * Check if WebSocket is connected
   * @returns True if connected, false otherwise
   */
  isConnectedToServer(): boolean {
    return this.isConnected;
  }

  /**
   * Get WebSocket ready state
   * @returns WebSocket ready state or null if not initialized
   */
  getReadyState(): number | null {
    return this.ws?.readyState ?? null;
  }

  /**
   * Wait for WebSocket to reach specific ready state
   * @param state Target ready state
   * @param timeout Timeout in milliseconds (default: 3000)
   */
  async waitForReadyState(state: number, timeout = 3000): Promise<void> {
    if (!this.ws) {
      throw new Error('WebSocket not initialized');
    }

    if (this.ws.readyState === state) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for ready state ${state} after ${timeout}ms`));
      }, timeout);

      const checkState = () => {
        if (this.ws?.readyState === state) {
          clearTimeout(timeoutId);
          resolve();
        } else {
          setTimeout(checkState, 50);
        }
      };

      checkState();
    });
  }

  /**
   * Get the count of received messages
   * @returns Number of messages received
   */
  getMessageCount(): number {
    return this.receivedMessages.length;
  }

  /**
   * Wait for a specific number of messages to be received
   * @param count Target message count
   * @param timeout Timeout in milliseconds (default: 5000)
   */
  async waitForMessageCount(count: number, timeout = 5000): Promise<void> {
    if (this.receivedMessages.length >= count) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.removeListener('message', messageHandler);
        reject(new Error(`Timeout waiting for ${count} messages after ${timeout}ms. Received: ${this.receivedMessages.length}`));
      }, timeout);

      const messageHandler = () => {
        if (this.receivedMessages.length >= count) {
          clearTimeout(timeoutId);
          this.removeListener('message', messageHandler);
          resolve();
        }
      };

      this.on('message', messageHandler);
    });
  }
}