import { render } from "../../render";
import { IN_FLIGHT_DOTS_TEMPLATE } from "./in-flight-dots.template";

export function renderInFlightDots(className: string): string {
	return render(IN_FLIGHT_DOTS_TEMPLATE, { className });
}
