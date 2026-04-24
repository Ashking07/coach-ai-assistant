import { Global, Module } from '@nestjs/common';
import { AnthropicLlmClient } from './llm/llm.client';
import { LLM_CLIENT } from './llm/llm.constants';
import { ClassifyIntentState } from './states/classify-intent.state';
import { LoadContextState } from './states/load-context.state';
import { DraftReplyState } from './states/draft-reply.state';
import { PolicyGate } from './gates/policy-gate';
import { ConfidenceGate } from './gates/confidence-gate';
import { OutboundService } from './outbound/outbound.service';
import { ChannelSenderModule } from './channels/channel-sender.module';

@Global()
@Module({
  imports: [ChannelSenderModule],
  providers: [
    AnthropicLlmClient,
    { provide: LLM_CLIENT, useExisting: AnthropicLlmClient },
    ClassifyIntentState,
    LoadContextState,
    DraftReplyState,
    PolicyGate,
    ConfidenceGate,
    OutboundService,
  ],
  exports: [
    ChannelSenderModule,
    LLM_CLIENT,
    ClassifyIntentState,
    LoadContextState,
    DraftReplyState,
    PolicyGate,
    ConfidenceGate,
    OutboundService,
  ],
})
export class AgentModule {}
