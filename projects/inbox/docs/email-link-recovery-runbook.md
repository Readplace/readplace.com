# Recover emails that exceeded the link limit

The extractor processes the first 300 unique links by default. It records which links it processed and the email's original article and issue destinations. A continuation that needs a higher limit lands in the unconsumed SQS dead-letter queue `inbox-extract-email-links-truncated-alert`. The CloudWatch alarm `inbox-extract-email-links-truncated-alarm` uses the visible message count and emails the existing operations subscription through SNS when the queue enters ALARM.

Recover within 14 days of the continuation's original enqueue time. For standard queues, time spent in the source queue counts toward the DLQ retention window. Check the DLQ immediately after an alarm because further arrivals while it is in ALARM do not cause another transition. AWS can take up to 15 minutes to publish metrics when an inactive queue becomes active. [Amazon SQS monitoring](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/monitoring-using-cloudwatch.html) Recovery also requires the original email to still be available.

1. Deploy the higher `INBOX_MAX_LINKS_PER_EMAIL` to the inbox stack. The default lives in the shared inbox domain package and also supplies the confirmation copy.
2. In the AWS SQS console for the affected account and region, open `inbox-extract-email-links-truncated-alert`.
3. Choose **Start DLQ redrive**, select **Redrive to source queue(s)**, and choose **Redrive messages**. The destination is `inbox-extract-email-links-recovery-q`.
4. Confirm that extraction resumes at the stored link position. A partial increase processes the newly covered links and leaves another continuation. After the final batch, check that the email's truncation notice clears and Gmail can finish once its selected outputs are saved.

[Amazon SQS dead-letter queue redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
