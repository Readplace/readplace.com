class BudgetExceeded extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BudgetExceeded";
	}
}

export const MAX_MEASURE_ATTEMPTS = 3;

export function assertWithinBudget(input: {
	what: string;
	meanMs: number;
	budgetMs: number;
}): void {
	if (input.meanMs < input.budgetMs) return;
	throw new BudgetExceeded(
		`${input.what} took ${Math.round(input.meanMs)}ms on average, over the ${input.budgetMs}ms budget`,
	);
}

function describeFailure(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
}

export async function measureUntilVerdict(input: {
	maxAttempts: number;
	diagnostic: (message: string) => void;
	measure: () => Promise<void>;
}): Promise<void> {
	for (let attempt = 1; attempt < input.maxAttempts; attempt++) {
		try {
			await input.measure();
			return;
		} catch (err) {
			if (err instanceof BudgetExceeded) throw err;
			input.diagnostic(
				`perf attempt ${attempt} of ${input.maxAttempts} failed, re-running: ${describeFailure(err)}`,
			);
		}
	}
	await input.measure();
}
