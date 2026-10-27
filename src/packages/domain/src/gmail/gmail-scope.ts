export function hasGmailScope(input: { grantedScope: string | undefined; scope: string }): boolean {
	return (input.grantedScope ?? "").split(" ").includes(input.scope);
}

export function hasAnyGmailScope(input: { grantedScope: string | undefined; scopes: readonly string[] }): boolean {
	return input.scopes.some((scope) => hasGmailScope({ grantedScope: input.grantedScope, scope }));
}
