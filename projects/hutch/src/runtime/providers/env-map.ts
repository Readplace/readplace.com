export function formatEnvMap(entries: Record<string, string>): string {
	return Object.entries(entries)
		.map(([key, value]) => `${key}=${value}`)
		.join(",");
}

export function parseEnvMap(raw: string): Record<string, string> {
	return Object.fromEntries(
		raw.split(",").map((entry) => {
			const [key, value] = entry.split("=");
			return [key, value];
		}),
	);
}
