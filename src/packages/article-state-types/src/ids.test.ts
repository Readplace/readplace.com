import { CandidateIdSchema, SaveAttemptIdSchema, UserIdSchema } from "./ids";

describe("UserIdSchema", () => {
	it("parses a string", () => {
		expect(UserIdSchema.parse("user-1")).toBe("user-1");
	});

	it("accepts an empty string", () => {
		expect(UserIdSchema.safeParse("").success).toBe(true);
	});

	it("rejects a number", () => {
		expect(UserIdSchema.safeParse(1).success).toBe(false);
	});
});

describe("SaveAttemptIdSchema", () => {
	it("parses a string", () => {
		expect(SaveAttemptIdSchema.parse("attempt-1")).toBe("attempt-1");
	});

	it("rejects an empty string", () => {
		expect(SaveAttemptIdSchema.safeParse("").success).toBe(false);
	});

	it("rejects a number", () => {
		expect(SaveAttemptIdSchema.safeParse(1).success).toBe(false);
	});
});

describe("CandidateIdSchema", () => {
	it("parses a string", () => {
		expect(CandidateIdSchema.parse("candidate-1")).toBe("candidate-1");
	});

	it("rejects an empty string", () => {
		expect(CandidateIdSchema.safeParse("").success).toBe(false);
	});

	it("rejects a number", () => {
		expect(CandidateIdSchema.safeParse(1).success).toBe(false);
	});
});
