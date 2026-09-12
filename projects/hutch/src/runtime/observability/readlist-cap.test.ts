import { READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { READLIST_CAP_APPROACHED_EVENT } from "./events";
import { initReportReadlistCap } from "./readlist-cap";

const params = {
	userId: UserIdSchema.parse("reader-1"),
	slug: ReadlistSlugSchema.parse("work"),
	label: "Work",
	createdAt: new Date("2026-09-11T00:00:00.000Z"),
};

describe("reporting a reader approaching the readlist cap", () => {
	it("reports a new readlist reaching one below the cap and returns the store result", async () => {
		const result = { created: true, ownedCount: READLIST_MAX_PER_USER - 1 };
		const createReadlistDefinition = jest.fn().mockResolvedValue(result);
		const metricLog = jest.fn();
		const create = initReportReadlistCap({ createReadlistDefinition, metricLog });

		expect(await create(params)).toBe(result);
		expect(createReadlistDefinition).toHaveBeenCalledWith(params);
		expect(metricLog).toHaveBeenCalledTimes(1);
		expect(metricLog).toHaveBeenCalledWith({
			event: READLIST_CAP_APPROACHED_EVENT,
			count: READLIST_MAX_PER_USER - 1,
			limit: READLIST_MAX_PER_USER,
			userId: params.userId,
		});
	});

	it.each([
		{ created: true, ownedCount: READLIST_MAX_PER_USER - 2 },
		{ created: true, ownedCount: READLIST_MAX_PER_USER },
		{ created: false, ownedCount: READLIST_MAX_PER_USER - 1 },
	])("does not report $created with $ownedCount readlists", async (result) => {
		const metricLog = jest.fn();
		const create = initReportReadlistCap({
			createReadlistDefinition: jest.fn().mockResolvedValue(result),
			metricLog,
		});

		expect(await create(params)).toBe(result);
		expect(metricLog).not.toHaveBeenCalled();
	});

	it("propagates a failed creation without reporting a crossing", async () => {
		const error = new Error("Readlist creation failed");
		const metricLog = jest.fn();
		const create = initReportReadlistCap({
			createReadlistDefinition: jest.fn().mockRejectedValue(error),
			metricLog,
		});

		await expect(create(params)).rejects.toBe(error);
		expect(metricLog).not.toHaveBeenCalled();
	});
});
