import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../render";
import type { FoundingAllocation } from "./founding-allocation";

const FOUNDING_PROGRESS_TEMPLATE = readFileSync(
	join(__dirname, "founding-progress.template.html"),
	"utf-8",
);

export function renderFoundingProgress(input: {
	userCount: number;
	foundingAllocation: FoundingAllocation;
}): string {
	const { userCount, foundingAllocation } = input;
	if (foundingAllocation.isFoundingAllocationExhausted(userCount)) {
		return "";
	}
	const progressPercent = Math.round(
		(userCount / foundingAllocation.foundingMemberLimit) * 100,
	);
	return render(FOUNDING_PROGRESS_TEMPLATE, {
		userCount,
		foundingMemberLimit: foundingAllocation.foundingMemberLimit,
		progressPercent,
	});
}
