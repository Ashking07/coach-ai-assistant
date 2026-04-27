import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import IORedis from 'ioredis';
import { getRedisUrl } from '../../bullmq.constants';
import { PrismaService } from '../../prisma.service';
import { MessagesService } from '../messages/messages.service';
import { DemoTokenService } from './demo-token.service';
import { WEB_CHAT_REPLY_CHANNEL } from './demo-chat.constants';

@Injectable()
export class DemoWebChatGateway implements OnModuleDestroy {
  private readonly logger = new Logger(DemoWebChatGateway.name);
  private wsServer: WebSocketServer | null = null;
  private subscriber: IORedis | null = null;
  private readonly socketsByParent = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly tokenService: DemoTokenService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
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

      this.logger.log({ event: 'WS_UPGRADE', path: parsedUrl.pathname });

      if (!this.isDemoEnabled()) {
        this.logger.warn({ event: 'WS_REJECTED', reason: 'DEMO_DISABLED' });
        socket.destroy();
        return;
      }

      const token = parsedUrl.searchParams.get('token');
      if (!token) {
        this.logger.warn({ event: 'WS_REJECTED', reason: 'NO_TOKEN' });
        socket.destroy();
        return;
      }

      const payload = this.tokenService.verifyParentToken(token);
      if (!payload) {
        this.logger.warn({ event: 'WS_REJECTED', reason: 'INVALID_TOKEN', tokenPrefix: token.slice(0, 20) });
        socket.destroy();
        return;
      }

      this.logger.log({ event: 'WS_ACCEPTED', parentId: payload.parentId });
      this.wsServer?.handleUpgrade(request, socket, head, (ws) => {
        this.registerConnection(payload.parentId, ws);
      });
    });

    // Subscribe to replies published by the worker process
    this.subscriber = new IORedis(getRedisUrl(), { maxRetriesPerRequest: null });
    void this.subscriber.subscribe(WEB_CHAT_REPLY_CHANNEL);
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const { parentId, content } = JSON.parse(raw) as { parentId: string; content: string };
        this.sendToParent(parentId, content);
      } catch {
        // malformed pub/sub message — ignore
      }
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
    this.subscriber?.disconnect();
    this.subscriber = null;
  }

  private registerConnection(parentId: string, ws: WebSocket): void {
    const existing = this.socketsByParent.get(parentId) ?? new Set<WebSocket>();
    existing.add(ws);
    this.socketsByParent.set(parentId, existing);

    ws.on('message', (rawData) => {
      void this.handleParentMessage(parentId, rawData.toString());
    });

    ws.on('close', () => {
      const sockets = this.socketsByParent.get(parentId);
      if (!sockets) return;
      sockets.delete(ws);
      if (sockets.size === 0) this.socketsByParent.delete(parentId);
    });
  }

  private async handleParentMessage(parentId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const parent = await this.prisma.parent.findUnique({
      where: { id: parentId },
      select: { phone: true, name: true, coachId: true },
    });

    if (!parent) {
      this.logger.warn({ event: 'DEMO_PARENT_NOT_FOUND', parentId });
      return;
    }

    try {
      await this.messagesService.ingest({
        coachId: parent.coachId,
        channel: 'WEB_CHAT',
        fromPhone: parent.phone,
        fromName: parent.name ?? undefined,
        content: trimmed,
        providerMessageId: `demo-${randomUUID()}`,
        receivedAt: new Date(),
      });
    } catch (err) {
      this.logger.error({ event: 'DEMO_INGEST_FAILED', parentId, err });
    }
  }

  private parseUrl(request: IncomingMessage): URL {
    return new URL(request.url ?? '/', 'http://localhost');
  }

  private isDemoEnabled(): boolean {
    const value = this.config.get('DEMO_PARENT_CHAT_ENABLED');
    return value === true || value === 'true' || value === '1';
  }
}
