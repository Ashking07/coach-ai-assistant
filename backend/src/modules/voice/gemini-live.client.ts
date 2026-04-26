import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { GEMINI_TOOL_DEFINITIONS } from './coach-command.types';

const VOICE_MODEL = 'gemini-2.5-flash-preview-native-audio-dialog';

const SYSTEM_INSTRUCTION = `
You are a voice command interpreter for an elite solo coach's dashboard.
You DO NOT take actions yourself - you ONLY emit a single tool call that
describes the coach's intent. The dashboard will render a confirmation
card and the coach will tap Confirm to actually execute.

Rules:
- Always pick exactly one tool. If you cannot map the request, do not call any tool.
- Be terse. The "summary" field is a 1-line verb phrase shown on the confirmation card.
- For draft_reply, write the full message body in the parent's voice (the coach is dictating).
- Never invent IDs. Use IDs the coach speaks aloud (e.g. "approve approval a-1-2-3") or the most recent items in the dashboard context the gateway sends with each session.
`.trim();

export interface GeminiLiveContext {
  pendingApprovals: { id: string; parentName: string; summary: string }[];
  todaySessions: { id: string; kidName: string; time: string }[];
  parents: { id: string; name: string }[];
}

export class GeminiLiveClient extends EventEmitter {
  private readonly logger = new Logger(GeminiLiveClient.name);
  private session: Session | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly context: GeminiLiveContext,
  ) {
    super();
  }

  async open(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const contextBlock = this.renderContext();

    this.session = await ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.TEXT],
        systemInstruction: {
          parts: [
            {
              text: `${SYSTEM_INSTRUCTION}\n\nCURRENT DASHBOARD CONTEXT:\n${contextBlock}`,
            },
          ],
        },
        tools: [{ functionDeclarations: GEMINI_TOOL_DEFINITIONS as unknown as never }],
      },
      callbacks: {
        onmessage: (msg) => this.handleMessage(msg),
        onerror: (err) => {
          this.logger.error({ event: 'GEMINI_ERROR', err });
          this.emit('error', err);
        },
        onclose: () => this.emit('close'),
        onopen: () => this.logger.log({ event: 'GEMINI_OPEN' }),
      },
    });
  }

  sendAudioChunk(buf: Buffer): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: buf.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }

  private handleMessage(msg: LiveServerMessage): void {
    const transcript = msg.serverContent?.inputTranscription?.text;
    if (transcript) {
      this.emit('transcript', transcript);
    }

    const toolCalls = msg.toolCall?.functionCalls;
    if (toolCalls && toolCalls.length > 0) {
      this.emit('toolCall', toolCalls[0]);
    }
  }

  private renderContext(): string {
    const lines: string[] = [];
    if (this.context.pendingApprovals.length) {
      lines.push('Pending approvals:');
      for (const a of this.context.pendingApprovals) {
        lines.push(`  - id=${a.id} parent=${a.parentName} (${a.summary})`);
      }
    }
    if (this.context.todaySessions.length) {
      lines.push("Today's sessions:");
      for (const s of this.context.todaySessions) {
        lines.push(`  - id=${s.id} ${s.kidName} at ${s.time}`);
      }
    }
    if (this.context.parents.length) {
      lines.push('Known parents:');
      for (const p of this.context.parents) {
        lines.push(`  - ${p.name}`);
      }
    }
    return lines.join('\n');
  }
}
