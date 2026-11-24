import assert from "node:assert/strict";
import { dashboardWindow } from "./admin-dashboards.url";

const DAY_MS = 86_400_000;

describe("dashboardWindow", () => {
	it("ends the window on the last 10-minute mark and starts it the range's days earlier", () => {
		const window = dashboardWindow({ range: "7d", now: new Date("2026-10-18T06:07:31.250Z") });

		assert.deepEqual(window, {
			startTime: new Date("2026-10-11T06:00:00.000Z"),
			endTime: new Date("2026-10-18T06:00:00.000Z"),
		});
	});

	it("keeps a clock already on a 10-minute mark", () => {
		const window = dashboardWindow({ range: "7d", now: new Date("2026-10-18T06:10:00.000Z") });

		assert.equal(window.endTime.toISOString(), "2026-10-18T06:10:00.000Z");
	});

	it("gives one window for every instant inside a step and a later one at the next mark", () => {
		const atMark = dashboardWindow({ range: "1d", now: new Date("2026-10-18T06:00:00.000Z") });
		const justBefore = dashboardWindow({ range: "1d", now: new Date("2026-10-18T06:09:59.999Z") });
		const nextMark = dashboardWindow({ range: "1d", now: new Date("2026-10-18T06:10:00.000Z") });

		assert.deepEqual(justBefore, atMark);
		assert.equal(nextMark.endTime.getTime() - atMark.endTime.getTime(), 600_000);
	});

	it("spans 1, 7, 30 and 90 days", () => {
		const now = new Date("2026-10-18T06:00:00.000Z");

		assert.deepEqual(
			(["1d", "7d", "30d", "90d"] as const).map((range) => {
				const { startTime, endTime } = dashboardWindow({ range, now });
				return (endTime.getTime() - startTime.getTime()) / DAY_MS;
			}),
			[1, 7, 30, 90],
		);
	});
});
