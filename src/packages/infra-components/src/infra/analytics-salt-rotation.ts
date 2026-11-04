export function analyticsSaltRotation(input: {
	deployed: { salt: string; generation: number | undefined } | undefined;
	next: { salt: string; generation: number };
}): "fresh-stack" | "unchanged" | "approved" | "refused" {
	const { deployed, next } = input;
	if (deployed === undefined) return "fresh-stack";
	if (deployed.salt === next.salt) return "unchanged";
	if (deployed.generation !== undefined && next.generation > deployed.generation) return "approved";
	return "refused";
}

export function isLambdaFunctionNotFound(error: unknown): boolean {
	return error instanceof Error && error.message.includes("ResourceNotFoundException: Function not found");
}
