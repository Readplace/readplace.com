import type { Logger } from "@packages/logger";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initGetSessionUserId } from "./get-session-user-id";
import { initObserveSession } from "./observe-session";
import { initResolveLogin, type ResolveLogin } from "./resolve-login";

export function initResolveWebsiteLogin(deps: {
	client: DynamoDBDocumentClient;
	sessionsTableName: string;
	salt: string;
	now: () => Date;
	logger: Logger;
	journalLogger: Logger.Typed<Record<string, unknown>>;
}): ResolveLogin {
	const observeSession = initObserveSession({
		salt: deps.salt,
		now: deps.now,
		logger: deps.journalLogger,
		context: () => ({ client: "web", surface: "website" }),
	});
	const getSessionUserId = initGetSessionUserId({
		client: deps.client,
		sessionsTableName: deps.sessionsTableName,
		observeSession,
	});
	return initResolveLogin({ getSessionUserId, logger: deps.logger });
}
