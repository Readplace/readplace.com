import { SUPPORTED_CLIENTS } from "@packages/supported-clients";

export const READLIST_PAGE_SIZE = 20;
export const EXTENSION_READLIST_PAGE_SIZE = 10;

export function readlistPageSizeForClient(oauthClientId: string | undefined): number {
	const client = SUPPORTED_CLIENTS.find(
		(candidate) => candidate.auth.kind === "builtIn" && candidate.auth.oauthClientId === oauthClientId,
	);
	return client?.group === "browserExtension" ? EXTENSION_READLIST_PAGE_SIZE : READLIST_PAGE_SIZE;
}
