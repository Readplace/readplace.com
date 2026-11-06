/** `consumed` distinguishes a fresh spend (this call incremented the counter)
 * from an idempotent re-consume of a message already counted this window (a
 * redelivery): only a fresh spend may later be refunded. */
export type ConsumePaidCrawlBudget = (input: {
	messageId: string;
}) => Promise<{ allowed: false } | { allowed: true; consumed: boolean }>;
export type RefundPaidCrawlBudget = () => Promise<void>;
