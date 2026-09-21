import { SESSION_TTL_SECONDS } from "./session-row";

const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;

export function isSessionDueForRenewal(session: { sessionExpiresAt: number; now: Date }): boolean {
	const secondsLeft = session.sessionExpiresAt - Math.floor(session.now.getTime() / 1000);
	return secondsLeft < SESSION_TTL_SECONDS - SESSION_RENEW_AFTER_SECONDS;
}
