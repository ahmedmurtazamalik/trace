import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

type RawRequest = Request & { body?: Buffer };

@Controller('webhooks/github')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @HttpCode(202)
  accept(
    @Headers('x-github-event') eventName: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: RawRequest,
  ): Promise<{ accepted: true } | { accepted: false; reason: 'untracked' }> {
    if (
      eventName !== 'push'
      || deliveryId === undefined
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deliveryId)
      || signature === undefined
      || !Buffer.isBuffer(request.body)
    ) {
      throw new BadRequestException({ code: 'WEBHOOK_HEADERS_INVALID', message: 'Webhook headers are invalid.' });
    }
    return this.webhooks.acceptPush(deliveryId, signature, request.body);
  }
}
