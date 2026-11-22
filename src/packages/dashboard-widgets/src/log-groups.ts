/**
 * Destination log group for the never-expire analytics feed. The forward-analytics
 * Lambda copies the JSON payload of every FORWARDED_STREAMS line from each source
 * group into here (preamble stripped so Logs Insights can query the fields), so
 * business/analytics history is retained forever while each source Lambda's own
 * group keeps its 30-day operational retention. A fixed string is safe because
 * staging and prod are separate AWS accounts, so the name never collides across
 * environments.
 */
export const ANALYTICS_LOG_GROUP = "/readplace/analytics";
