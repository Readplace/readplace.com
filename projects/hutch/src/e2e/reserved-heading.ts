import assert from "node:assert/strict";
import type { ReservedHeadingGeometry } from "./reserved-heading.browser";

export const TOLERANCE_PX = 1;
export const VIEWPORT_HEIGHT = 844;

export interface MeasuredHeading {
	shown: string;
	geometry: ReservedHeadingGeometry;
}

/**
 * What every heading that rotates its own text owes the page: it reserves a box
 * up front and keeps it, whatever it is currently showing. Without that the text
 * either spills over what follows or shoves it down the page mid-read.
 */
export function expectReservedBoxHeld(measurements: MeasuredHeading[], describes: string): void {
	assert.ok(measurements.length > 1, `${describes} must rotate through more than one entry`);
	const reference = measurements[0];
	for (const { shown, geometry } of measurements) {
		assert.ok(
			geometry.reservedHeight > 0,
			`${describes} must reserve a box from its line count and line-height, computed ${geometry.reservedHeight}px`,
		);
		assert.ok(
			Math.abs(geometry.titleHeight - geometry.reservedHeight) <= TOLERANCE_PX,
			`"${shown}" must leave ${describes} at its reserved ${geometry.reservedHeight}px, measured ${geometry.titleHeight}px`,
		);
		assert.ok(
			geometry.contentHeight <= geometry.reservedHeight + TOLERANCE_PX,
			`"${shown}" renders ${geometry.contentHeight}px of text out of a ${geometry.reservedHeight}px box, so it spills over what follows`,
		);
		assert.ok(
			Math.abs(geometry.belowOffset - reference.geometry.belowOffset) <= TOLERANCE_PX,
			`"${shown}" must leave what follows ${describes} ${reference.geometry.belowOffset}px below its top, measured ${geometry.belowOffset}px`,
		);
	}
}
