import assert from "node:assert";

export function rankNewLinksAbove<T>(params: {
	items: readonly T[];
	instants: readonly Date[];
	isNew: (item: T) => boolean;
}): Date[] {
	const { items, instants, isNew } = params;
	assert.equal(items.length, instants.length, "one allocated instant per item");
	const alreadySavedCount = items.filter((item) => !isNew(item)).length;
	let nextAlreadySaved = 0;
	let nextNew = alreadySavedCount;
	return items.map((item) => instants[isNew(item) ? nextNew++ : nextAlreadySaved++]);
}
