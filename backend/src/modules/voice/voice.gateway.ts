import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { GeminiLiveClient } from './gemini-live.client';
import { toolCallToProposal } from './coach-command.types';

@Injectable()
export class VoiceGateway implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private wsServer: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly config: ConfigService,
    private readonly commands: CoachCommandService,
    private readonly dashboard: DashboardService,
  ) {}

  attachToHttpServer(server: HttpServer): void {
    if (this.wsServer) return;

    this.wsServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws/coach-voice') return;

      if (!this.config.get('VOICE_ENABLED')) {
        this.logger.warn({ event: 'VOICE_WS_REJECTED', reason: 'DISABLED' });
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
      if (!token || !timingSafeEqualStr(token, expected)) {
        this.logger.warn({ event: 'VOICE_WS_REJECTED', reason: 'AUTH' });
        socket.destroy();
        return;
      }

      this.wsServer!.handleUpgrade(request, socket, head, (ws) => {
        this.wsServer!.emit('connection', ws, request);
        void this.handleConnection(ws);
      });
    });
  }

  onModuleDestroy(): void {
    for (const c of this.clients) c.close();
    this.wsServer?.close();
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
    const coachId = this.config.getOrThrow<string>('COACH_ID');
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    this.clients.add(ws);

    const [home, parents] = await Promise.all([
      this.dashboard.getHome(coachId),
      this.dashboard.getParents(coachId),
    ]);

    const gemini = new GeminiLiveClient(apiKey, {
      pendingApprovals: home.approvals.map((a) => ({
        id: a.id,
        parentName: a.parent,
        summary: a.intent,
      })),
      todaySessions: home.sessions.map((s) => ({
        id: s.id,
        kidName: s.kid,
        time: s.time,
      })),
      parents: parents.map((p) => ({ id: p.id, name: p.name })),
    });

    let proposalSent = false;

    gemini.on('transcript', (text: string) => {
      ws.send(JSON.stringify({ type: 'transcript', text }));
    });

    gemini.on('toolCall', (call: { name: string; args: Record<string, unknown> }) => {
      try {
        const proposal = toolCallToProposal(call.name, call.args);
        if (!proposal) {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown tool: ${call.name}` }));
          return;
        }

        const stored = this.commands.storeProposal(coachId, proposal);
        proposalSent = true;
        ws.send(
          JSON.stringify({
            type: 'proposal',
            id: stored.id,
            expiresAt: stored.expiresAt.toISOString(),
            proposal: stored.proposal,
          }),
        );
      } catch (err) {
        this.logger.error({ event: 'PROPOSAL_PARSE_FAILED', err });
        ws.send(
          JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'parse failed',
          }),
        );
      }
    });

    gemini.on('error', (err: unknown) => {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'gemini error',
        }),
      );
    });

    gemini.on('close', () => {
      if (!proposalSent && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'try_again',
            message: 'No command recognized. Try again.',
          }),
        );
      }
    });

    try {
      await gemini.open();
      ws.send(JSON.stringify({ type: 'ready' }));
    } catch (err) {
      this.logger.error({ event: 'GEMINI_OPEN_FAILED', err });
      ws.send(JSON.stringify({ type: 'error', message: 'failed to open voice session' }));
      ws.close();
      return;
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary && Buffer.isBuffer(data)) {
        gemini.sendAudioChunk(data);
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      gemini.close();
    });
  }
}
