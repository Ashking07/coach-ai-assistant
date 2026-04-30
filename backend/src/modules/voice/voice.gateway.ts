import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { toolCallToProposal, GEMINI_TOOL_DEFINITIONS } from './coach-command.types';
import type { GeminiLiveContext } from './gemini-live.client';

const SYSTEM_PROMPT = `
You are a voice command interpreter for an elite solo sports coach's dashboard.
The input is raw speech-to-text — it may have transcription errors, wrong word boundaries, or mishear names.
Your job: extract the coach's intent and call exactly ONE tool. Be generous — if the intent is plausible, call the tool.
Only skip calling a tool if the speech is truly unrelated to any coaching action (e.g. random words, coughing).

DATES & TIMES
- Timezone: America/Los_Angeles. Format: ISO 8601 with offset (e.g. "2026-04-26T15:00:00-07:00").
- "today" = the date in Today header. "tomorrow" = next day. "Monday" etc = next occurrence.
- If only a start time given, end = start + 1 hour.
- "8 p.m." / "8:00 p.m." / "8 PM" / "20:00" all mean the same thing.

KID NAMES (speech-to-text often mishears proper nouns)
- Match kid names PHONETICALLY and FUZZILY against the "Known kids" list in context.
- Common mishearings: "Aryan" → "audience"/"Ryan"/"Iranian", "Aarav" → "arrow"/"aura", "Kofi" → "coffee"/"copy", "Luca" → "Luke", "Mateo" → "matteo"/"mateo", "Rhea" → "Ria"/"rear", "Sora" → "Sara"/"Zara".
- If a word SOUNDS LIKE a kid name, treat it as that kid.

TOOL SELECTION
- approve_pending: "approve", "send it", "looks good", "go ahead with [name]'s message"
- dismiss_pending: "dismiss", "reject", "skip", "don't send"
- add_availability: "mark available", "I'm free", "open up", "make [time] available", "add a slot", "I'm available", "mark [time] available", "mark [day] available", "available at", "add availability", "block my availability" (when meaning 'add available time')
- block_availability: "block off", "I'm busy", "mark unavailable", "block out" (when meaning 'make time unavailable/blocked')
- schedule_session: "schedule", "book", "put [kid] on", "add [kid] to the calendar", "session with [kid]", "train [kid]", "[kid] is coming"
- cancel_session: "cancel", "remove session", "take off the schedule"
- draft_reply: "reply to [parent]", "send [parent] a message", "tell [parent]"

APPROVALS: "the first one" / "top one" / "that one" = use first approvalId in context.
SESSIONS: for cancel/schedule, match session or kid from context.
`.trim();

const VOICE_CLAUDE_TIMEOUT_MS = 30_000;

@Injectable()
export class VoiceGateway implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private wsServer: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private readonly anthropic: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly commands: CoachCommandService,
    private readonly dashboard: DashboardService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  attachToHttpServer(server: HttpServer): void {
    if (this.wsServer) return;

    this.wsServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws/coach-voice') return;

      if (!this.config.get('VOICE_ENABLED')) {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
      if (!token || !timingSafeEqualStr(token, expected)) {
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
    this.clients.add(ws);

    const [home, parents, kids] = await Promise.all([
      this.dashboard.getHome(coachId),
      this.dashboard.getParents(coachId),
      this.dashboard.getKids(coachId),
    ]);

    const context: GeminiLiveContext = {
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
      kids,
    };

    ws.send(JSON.stringify({ type: 'ready' }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; text?: string };
        if (msg.type === 'transcript' && msg.text) {
          this.logger.log({ event: 'VOICE_TRANSCRIPT_RECEIVED', text: msg.text.slice(0, 100) });
          ws.send(JSON.stringify({ type: 'processing' }));
          void this.processTranscript(ws, coachId, msg.text, context);
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  private async processTranscript(
    ws: WebSocket,
    coachId: string,
    transcript: string,
    context: GeminiLiveContext,
  ): Promise<void> {
    const contextBlock = this.renderContext(context);
    const nowLA = new Date().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const defaultTimeLA = (() => {
      const d = new Date();
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      return d.toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    })();
    const today = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date());

    const tools: Anthropic.Tool[] = GEMINI_TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters.properties,
        required: [...t.parameters.required],
      },
    }));

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), VOICE_CLAUDE_TIMEOUT_MS);

    try {
      const response = await this.anthropic.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system: `${SYSTEM_PROMPT}\n\nCurrent time (LA): ${nowLA}\nDefault time when none given: ${defaultTimeLA}\nIMPORTANT: startAtIso and endAtIso MUST be full ISO 8601 with America/Los_Angeles offset, e.g. "2026-04-30T15:00:00-07:00". Never use bare dates or Z suffix.\n\nToday: ${today}\n\n${contextBlock}`,
          tools,
          tool_choice: { type: 'auto' },
          messages: [{ role: 'user', content: transcript }],
        },
        { signal: abort.signal },
      );

      const toolUse = response.content.find((b) => b.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'try_again', message: 'No command recognized. Try saying something like "Approve the first pending message" or "Block tomorrow at 3 PM".' }));
        }
        return;
      }

      this.logger.log({ event: 'VOICE_TOOL_CALL', name: toolUse.name });

      const proposal = toolCallToProposal(toolUse.name, toolUse.input as Record<string, unknown>);
      if (!proposal) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'try_again', message: 'Could not parse command. Try again.' }));
        }
        return;
      }

      const stored = this.commands.storeProposal(coachId, proposal);
      this.logger.log({ event: 'VOICE_PROPOSAL_STORED', id: stored.id, tool: toolUse.name });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'proposal',
          id: stored.id,
          expiresAt: stored.expiresAt.toISOString(),
          proposal: stored.proposal,
        }));
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      this.logger.error({ event: 'VOICE_CLAUDE_FAILED', timeout: isTimeout, err: err instanceof Error ? err.message : String(err) });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: isTimeout ? 'Command timed out. Try again.' : 'Command processing failed. Try again.' }));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private renderContext(context: GeminiLiveContext): string {
    const lines: string[] = [];
    if (context.pendingApprovals.length) {
      lines.push('Pending approvals:');
      for (const a of context.pendingApprovals) {
        lines.push(`  - id=${a.id} parent=${a.parentName} (${a.summary})`);
      }
    }
    if (context.todaySessions.length) {
      lines.push("Today's sessions:");
      for (const s of context.todaySessions) {
        lines.push(`  - id=${s.id} ${s.kidName} at ${s.time}`);
      }
    }
    if (context.parents.length) {
      lines.push('Known parents:');
      for (const p of context.parents) lines.push(`  - ${p.name} (id=${p.id})`);
    }
    if (context.kids.length) {
      lines.push('Known kids (use these for schedule_session):');
      for (const k of context.kids) lines.push(`  - ${k.name} (id=${k.id}, parent=${k.parentName})`);
    }
    return lines.join('\n');
  }
}
