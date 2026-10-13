import { scoreSharedWords } from "./shared-words-score";

const page = (title: string, description = "") => ({ title, description });

describe("scoreSharedWords", () => {
	it("uses the measured BM25 constants, title frequency and document frequency", () => {
		const scores = scoreSharedWords({
			target: page("quasar"),
			candidates: [page("quasar", "pulsar"), page("nebula", "dust"), page("nebula", "dust")],
		});
		expect(scores[0]).toBeCloseTo(Math.log(1 + 2.5 / 1.5) * 4.4 / 3.2, 12);
		expect(scores.slice(1)).toEqual([0, 0]);
	});

	it("counts repeated query words only once", () => {
		const candidates = [page("quasar", "pulsar")];
		expect(scoreSharedWords({ target: page("quasar quasar", "quasar"), candidates }))
			.toEqual(scoreSharedWords({ target: page("quasar"), candidates }));
	});

	it("retains dots, dashes, plus and hash inside ASCII tokens", () => {
		const candidates = [page("node.js"), page("node-js"), page("c++"), page("c#"), page("δβ")];
		const scores = scoreSharedWords({ target: page("node.js c++ c#"), candidates });
		expect(scores[0]).toBeGreaterThan(0);
		expect(scores[1]).toBe(0);
		expect(scores[2]).toBeGreaterThan(0);
		expect(scores[3]).toBeGreaterThan(0);
		expect(scores[4]).toBe(0);
	});

	it("removes short tokens and checks stop words before the seven-character prefix", () => {
		expect(scoreSharedWords({ target: page("throughout"), candidates: [page("throughout")] })[0])
			.toBeGreaterThan(0);
		expect(scoreSharedWords({ target: page("through a x"), candidates: [page("throughout x a")] }))
			.toEqual([0]);
		expect(scoreSharedWords({ target: page("abcdefg1"), candidates: [page("abcdefg2")] })[0])
			.toBeGreaterThan(0);
	});

	it("cuts raw title and description at 300 Unicode code points", () => {
		const prefix = "😀".repeat(294);
		const candidates = [page("quasar")];
		expect(scoreSharedWords({ target: page(`${prefix}quasar`), candidates })[0]).toBeGreaterThan(0);
		expect(scoreSharedWords({ target: page(`${prefix} quasars`), candidates })).toEqual([0]);
		expect(scoreSharedWords({ target: page("", `${prefix}quasar`), candidates })[0]).toBeGreaterThan(0);
		expect(scoreSharedWords({ target: page("", `${prefix} quasars`), candidates })).toEqual([0]);
		expect(scoreSharedWords({ target: page(`${" ".repeat(300)}quasar`), candidates })).toEqual([0]);
	});

	it("does not stem plurals", () => {
		expect(scoreSharedWords({ target: page("globin"), candidates: [page("globins")] })).toEqual([0]);
	});

	it("scores empty texts and empty corpora without a match", () => {
		expect(scoreSharedWords({ target: page("quasar"), candidates: [page(""), page("the a")] })).toEqual([0, 0]);
		expect(scoreSharedWords({ target: page("quasar"), candidates: [] })).toEqual([]);
	});
});
