import { Test } from '@nestjs/testing';
import { VoiceGateway } from './voice.gateway';
import { ConfigService } from '@nestjs/config';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { createServer } from 'node:http';
import WebSocket from 'ws';

describe('VoiceGateway upgrade auth', () => {
  let gateway: VoiceGateway;
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) => {
              if (k === 'DASHBOARD_TOKEN') return 'a'.repeat(20);
              if (k === 'COACH_ID') return 'coach_1';
              if (k === 'GEMINI_API_KEY') return 'fake-key';
              if (k === 'VOICE_ENABLED') return true;
              throw new Error(k);
            },
            get: (k: string) => (k === 'VOICE_ENABLED' ? true : undefined),
          },
        },
        { provide: CoachCommandService, useValue: { storeProposal: jest.fn() } },
        {
          provide: DashboardService,
          useValue: {
            getHome: jest.fn().mockResolvedValue({
              approvals: [],
              sessions: [],
              fires: [],
              autoHandled: [],
              stats: { firesCount: 0, handledCount: 0 },
            }),
            getParents: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    gateway = moduleRef.get(VoiceGateway);
    server = createServer();
    gateway.attachToHttpServer(server);

    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    gateway.onModuleDestroy();
    server.close();
  });

  it('rejects connections without a token', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/coach-voice`);
    ws.on('error', () => done());
    ws.on('open', () => done.fail('should have been rejected'));
  });

  it('rejects connections with a wrong token', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/coach-voice?token=wrong`);
    ws.on('error', () => done());
    ws.on('open', () => done.fail('should have been rejected'));
  });

  it('accepts connections with the valid token', (done) => {
    const ws = new WebSocket(
      `ws://localhost:${port}/ws/coach-voice?token=${'a'.repeat(20)}`,
    );
    ws.on('open', () => {
      ws.close();
      done();
    });
    ws.on('error', (e) => done(e));
  });
});
