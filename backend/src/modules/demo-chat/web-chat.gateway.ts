import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { DemoTokenService } from './demo-token.service';

@Injectable()
export class DemoWebChatGateway implements OnModuleDestroy {
  private wsServer: WebSocketServer | null = null;
  private readonly socketsByParent = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly tokenService: DemoTokenService,
    private readonly config: ConfigService,
  ) {}

  attachToHttpServer(server: HttpServer): void {
    if (this.wsServer) {
      return;
    }

    this.wsServer = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const parsedUrl = this.parseUrl(request);
      if (parsedUrl.pathname !== '/ws/demo-parent') {
        return;
      }

      if (!this.isDemoEnabled()) {
        socket.destroy();
        return;
      }

      const token = parsedUrl.searchParams.get('token');
      if (!token) {
        socket.destroy();
        return;
      }

      const payload = this.tokenService.verifyParentToken(token);
      if (!payload) {
        socket.destroy();
        return;
      }

      this.wsServer?.handleUpgrade(request, socket, head, (ws) => {
        this.registerConnection(payload.parentId, ws);
      });
    });
  }

  sendToParent(parentId: string, content: string): boolean {
    const sockets = this.socketsByParent.get(parentId);
    if (!sockets || sockets.size === 0) {
      return false;
    }

    const payload = JSON.stringify({
      type: 'message',
      content,
      parentId,
      sentAt: new Date().toISOString(),
    });

    let delivered = false;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        delivered = true;
      }
    }

    return delivered;
  }

  onModuleDestroy(): void {
    this.wsServer?.close();
    this.wsServer = null;
    this.socketsByParent.clear();
  }

  private registerConnection(parentId: string, ws: WebSocket): void {
    const existing = this.socketsByParent.get(parentId) ?? new Set<WebSocket>();
    existing.add(ws);
    this.socketsByParent.set(parentId, existing);

    ws.on('close', () => {
      const sockets = this.socketsByParent.get(parentId);
      if (!sockets) {
        return;
      }
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.socketsByParent.delete(parentId);
      }
    });
  }

  private parseUrl(request: IncomingMessage): URL {
    return new URL(request.url ?? '/', 'http://localhost');
  }

  private isDemoEnabled(): boolean {
    const value = this.config.get('DEMO_PARENT_CHAT_ENABLED');
    return value === true || value === 'true' || value === '1';
  }
}
