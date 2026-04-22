import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { TEST_JOB_QUEUE } from './bullmq.module';

async function makeController(): Promise<AppController> {
  const mod: TestingModule = await Test.createTestingModule({
    controllers: [AppController],
    providers: [
      AppService,
      {
        provide: PrismaService,
        useValue: { coach: { count: jest.fn().mockResolvedValue(0) } },
      },
      {
        provide: TEST_JOB_QUEUE,
        useValue: { add: jest.fn().mockResolvedValue({ id: 'x' }) },
      },
    ],
  }).compile();
  return mod.get<AppController>(AppController);
}

describe('AppController', () => {
  describe('root', () => {
    it('should return "Hello World!"', async () => {
      const ctrl = await makeController();
      expect(ctrl.getHello()).toBe('Hello World!');
    });
  });

  describe('dev/test-job guard', () => {
    const origEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = origEnv;
    });

    it('throws NotFoundException in production', async () => {
      process.env.NODE_ENV = 'production';
      const ctrl = await makeController();
      await expect(
        ctrl.enqueueTestJob({ message: 'hi' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('enqueues outside production', async () => {
      process.env.NODE_ENV = 'development';
      const ctrl = await makeController();
      const res = await ctrl.enqueueTestJob({ message: 'hi' });
      expect(res.ok).toBe(true);
      expect(res.jobId).toBe('x');
    });
  });
});
