import { Module } from '@nestjs/common';
import { GithubWebhookQueue } from './github-webhook.queue';
import { GithubWebhookPublisher } from './github-webhook.publisher';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [GithubWebhookQueue, GithubWebhookPublisher, WebhooksService],
})
export class WebhooksModule {}
