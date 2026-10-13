import { contentWords } from "./shared-subject-words";

describe("contentWords", () => {
	it("splits on accents, punctuation, quotes and dashes while retaining plus and hash", () => {
		expect(contentWords("CAFÉ…queues ‘decay’ rust-tools C++ C# F#"))
			.toEqual(new Set(["caf", "queue", "decay", "rust", "tool", "c++", "c#", "f#"]));
	});

	it("drops stop words and one-character tokens", () => {
		expect(contentWords("the both story articles reading guide news www a z + # 7"))
			.toEqual(new Set());
	});

	it("keeps the two-character allow list and tokens containing digits", () => {
		expect(contentWords("ai ml js ts ui ux os vr eu uk c# f# go 42 x2 2x ar io xx"))
			.toEqual(new Set("ai ml js ts ui ux os vr eu uk c# f# go 42 x2 2x".split(" ")));
	});

	it("stems long ies plurals and other trailing s except ss", () => {
		expect(contentWords("libraries ties cats gas bass business"))
			.toEqual(new Set(["librar", "tie", "cat", "gas", "bass", "busine"]));
	});

	it("checks the stop list after stemming", () => {
		expect(contentWords("guides intros introductions"))
			.toEqual(new Set());
	});

	it("keeps six-character prefixes and distinct words only", () => {
		expect(contentWords("reconciliation reconcile reconciled"))
			.toEqual(new Set(["reconc"]));
	});

	it("returns no words for text with no ASCII tokens", () => {
		expect(contentWords("δβ …"))
			.toEqual(new Set());
	});
});
