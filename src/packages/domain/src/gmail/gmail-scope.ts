export function hasGmailScope(input: { grantedScope: string | undefined; scope: string }): boolean {
	return (input.grantedScope ?? "").split(" ").includes(input.scope);
}
