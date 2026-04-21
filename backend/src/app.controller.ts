import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { Job } from 'bullmq';
import { AppService } from './app.service';
import { DEV_TEST_QUEUE } from './bullmq.constants';
import { TEST_JOB_QUEUE } from './bullmq.module';
import { PrismaService } from './prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    @Inject(TEST_JOB_QUEUE)
    private readonly testJobQueue: import('bullmq').Queue,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    const coachCount = await this.prisma.coach.count();
    return { status: 'ok', coaches: coachCount };
  }

  @Post('dev/test-job')
  async enqueueTestJob(@Body() body: { message?: string }) {
    const message = body.message ?? 'hello';
    const job = await this.testJobQueue.add(DEV_TEST_QUEUE, {
      message,
    });

    return {
      ok: true,
      queue: DEV_TEST_QUEUE,
      jobId: job.id,
      payload: { message },
    };
  }
}
