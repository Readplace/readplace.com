export function rememberLastCall<Input, Output>(deps: {
	keyOf: (input: Input) => readonly unknown[];
	compute: (input: Input) => Output;
}): (input: Input) => Output {
	let last: { key: readonly unknown[]; output: Output } | undefined;
	return (input) => {
		const key = deps.keyOf(input);
		if (last?.key.every((part, index) => part === key[index])) return last.output;
		const output = deps.compute(input);
		last = { key, output };
		return output;
	};
}
