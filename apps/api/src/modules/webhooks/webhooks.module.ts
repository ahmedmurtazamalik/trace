import { Module } from '@nestjs/common';
import { GithubWebhookQueue } from './github-webhook.queue';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [GithubWebhookQueue, WebhooksService],
})
export class WebhooksModule {}
