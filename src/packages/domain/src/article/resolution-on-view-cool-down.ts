import { ARTICLE_REFRESH_DEADLINE_MS } from "./article-refresh-deadline";

export function resolutionOnViewCoolDownCutoff(now: Date): string {
	return new Date(now.getTime() - ARTICLE_REFRESH_DEADLINE_MS).toISOString();
}
