import { type ClientInGroup, SUPPORTED_CLIENTS } from "@packages/supported-clients";

export function findRosterAssistant(registeredName: string): ClientInGroup<"aiAssistant"> | undefined {
	return SUPPORTED_CLIENTS.find(
		(candidate): candidate is ClientInGroup<"aiAssistant"> =>
			candidate.group === "aiAssistant" &&
			candidate.displayName.toLowerCase() === registeredName.trim().toLowerCase(),
	);
}
