import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../../render";
import {
	FOUNDING_MEMBER_LIMIT,
	isFoundingAllocationExhausted,
} from "./founding-allocation";

const FOUNDING_PROGRESS_TEMPLATE = readFileSync(
	join(__dirname, "founding-progress.template.html"),
	"utf-8",
);

export function renderFoundingProgress(input: { userCount: number }): string {
	const { userCount } = input;
	if (isFoundingAllocationExhausted(userCount)) {
		return "";
	}
	const progressPercent = Math.round((userCount / FOUNDING_MEMBER_LIMIT) * 100);
	return render(FOUNDING_PROGRESS_TEMPLATE, {
		userCount,
		foundingMemberLimit: FOUNDING_MEMBER_LIMIT,
		progressPercent,
	});
}
