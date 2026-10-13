import { parseHTML } from "linkedom";

type PopoverFocusProblem = "panel-autofocus" | "no-target" | "many-targets" | "tooltip-autofocus";

type PopoverRole = "dialog" | "tooltip";

export interface PopoverFocusGap {
	popover: string;
	problem: PopoverFocusProblem;
}

interface PopoverScope {
	popover: Element;
	targets: readonly Element[];
}

const RULES: Record<PopoverRole, (scope: PopoverScope) => PopoverFocusProblem[]> = {
	dialog: ({ popover, targets }) => [
		...(popover.hasAttribute("autofocus") ? ["panel-autofocus" as const] : []),
		...(targets.length === 0 ? ["no-target" as const] : []),
		...(targets.length > 1 ? ["many-targets" as const] : []),
	],
	tooltip: ({ popover }) =>
		popover.hasAttribute("autofocus") || popover.querySelector("[autofocus]") ? ["tooltip-autofocus"] : [],
};

function roleOf(popover: Element): PopoverRole {
	return popover.getAttribute("role") === "dialog" ? "dialog" : "tooltip";
}

function nameOf(popover: Element): string {
	return popover.getAttribute("id") ?? popover.tagName.toLowerCase();
}

export function findPopoverFocusGaps(html: string): PopoverFocusGap[] {
	const { document } = parseHTML(html);
	return Array.from(document.querySelectorAll("[popover]")).flatMap((popover) => {
		const targets = Array.from(popover.querySelectorAll("[autofocus]")).filter(
			(target) => target.closest("[popover]") === popover,
		);
		return RULES[roleOf(popover)]({ popover, targets }).map((problem) => ({ popover: nameOf(popover), problem }));
	});
}

export function describePopoverFocusGaps(gaps: readonly PopoverFocusGap[]): string[] {
	return gaps.map((gap) => `${gap.problem}: ${gap.popover}`);
}
