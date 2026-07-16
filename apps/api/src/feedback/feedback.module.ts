import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackWebhookService } from './feedback-webhook.service';
import { FeedbackController } from './feedback.controller';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, FeedbackWebhookService],
})
export class FeedbackModule {}
