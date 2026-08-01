import { SUPPORTED_CLIENTS } from "@packages/supported-clients";

export const QUEUE_PAGE_SIZE = 20;
export const EXTENSION_QUEUE_PAGE_SIZE = 10;

export function queuePageSizeForClient(oauthClientId: string | undefined): number {
	const client = SUPPORTED_CLIENTS.find(
		(candidate) => candidate.auth.kind === "builtIn" && candidate.auth.oauthClientId === oauthClientId,
	);
	return client?.group === "browserExtension" ? EXTENSION_QUEUE_PAGE_SIZE : QUEUE_PAGE_SIZE;
}
