import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBS_EMITTER } from './observability.constants';
import { createObsEmitter } from './obs-emitter.factory';

@Global()
@Module({
  providers: [
    {
      provide: OBS_EMITTER,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => createObsEmitter(config),
    },
  ],
  exports: [OBS_EMITTER],
})
export class ObservabilityModule {}
