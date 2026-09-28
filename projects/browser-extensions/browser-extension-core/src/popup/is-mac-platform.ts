export function isMacPlatform(agent: {
	platform: string;
	userAgentData?: { platform: string };
}): boolean {
	return agent.userAgentData
		? agent.userAgentData.platform === "macOS"
		: agent.platform.startsWith("Mac");
}
