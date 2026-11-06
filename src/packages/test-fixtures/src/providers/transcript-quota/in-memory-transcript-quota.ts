import type {
	ChargeTranscriptQuota,
	DeleteAllTranscriptQuota,
	MarkTranscriptStarted,
	RefundTranscriptCharge,
	RefundUnstartedCharge,
	SettleTranscriptCharge,
	TranscriptChargeRef,
	TranscriptChargeState,
} from "@packages/provider-contracts/transcript-quota";

type ChargeEntry = { seconds: number; state: TranscriptChargeState; day: string };

export type InMemoryTranscriptQuotaRows = {
	charges: Map<string, ChargeEntry>;
	spentSeconds: Map<string, number>;
};

const chargeKey = (ref: TranscriptChargeRef) => `${ref.userId}#${ref.uploadId}#${ref.attempt}`;
const dayKey = (p: { userId: string; day: string }) => `${p.userId}#${p.day}`;

function addSpentSeconds(rows: InMemoryTranscriptQuotaRows, p: { userId: string; day: string; seconds: number }) {
	const key = dayKey(p);
	rows.spentSeconds.set(key, (rows.spentSeconds.get(key) ?? 0) + p.seconds);
}

export function initInMemoryTranscriptQuotaRows(): InMemoryTranscriptQuotaRows {
	return { charges: new Map(), spentSeconds: new Map() };
}

export function initInMemoryTranscriptCharge(deps: {
	rows: InMemoryTranscriptQuotaRows;
	allowanceSeconds: number;
	now: () => Date;
}): { chargeTranscriptQuota: ChargeTranscriptQuota } {
	const chargeTranscriptQuota: ChargeTranscriptQuota = async (p) => {
		if (p.seconds > deps.allowanceSeconds) return { outcome: "over-allowance" };
		const existing = deps.rows.charges.get(chargeKey(p));
		if (existing && existing.state !== "refunded") return { outcome: "already-charged" };
		const day = deps.now().toISOString().slice(0, 10);
		const spent = deps.rows.spentSeconds.get(dayKey({ userId: p.userId, day })) ?? 0;
		if (spent > deps.allowanceSeconds - p.seconds) return { outcome: "day-spent" };
		deps.rows.charges.set(chargeKey(p), { seconds: p.seconds, state: "reserved", day });
		addSpentSeconds(deps.rows, { userId: p.userId, day, seconds: p.seconds });
		return { outcome: "charged", day };
	};
	return { chargeTranscriptQuota };
}

export function initInMemoryTranscriptLedger(deps: { rows: InMemoryTranscriptQuotaRows }): {
	markTranscriptStarted: MarkTranscriptStarted;
	settleTranscriptCharge: SettleTranscriptCharge;
	refundTranscriptCharge: RefundTranscriptCharge;
	refundUnstartedCharge: RefundUnstartedCharge;
	deleteAllTranscriptQuota: DeleteAllTranscriptQuota;
} {
	const { charges, spentSeconds } = deps.rows;
	const isOpen = (entry: ChargeEntry | undefined): entry is ChargeEntry =>
		entry?.state === "reserved" || entry?.state === "started";

	const moveOpenCharge = (ref: TranscriptChargeRef, to: "started" | "settled") => {
		const entry = charges.get(chargeKey(ref));
		if (!isOpen(entry)) return { outcome: "closed" as const };
		entry.state = to;
		return { outcome: "done" as const };
	};

	const refund = (entry: ChargeEntry, p: { userId: string; day: string; seconds: number }) => {
		entry.state = "refunded";
		addSpentSeconds(deps.rows, { userId: p.userId, day: p.day, seconds: -p.seconds });
	};

	return {
		markTranscriptStarted: async (ref) => moveOpenCharge(ref, "started"),
		settleTranscriptCharge: async (ref) => moveOpenCharge(ref, "settled"),
		refundTranscriptCharge: async (p) => {
			const entry = charges.get(chargeKey(p));
			if (!isOpen(entry)) return { outcome: "closed" };
			refund(entry, p);
			return { outcome: "refunded" };
		},
		refundUnstartedCharge: async (p) => {
			const entry = charges.get(chargeKey(p));
			if (entry?.state === "started") return { outcome: "started" };
			if (entry?.state !== "reserved") return { outcome: "closed" };
			refund(entry, p);
			return { outcome: "refunded" };
		},
		deleteAllTranscriptQuota: async ({ userId }) => {
			for (const map of [charges, spentSeconds]) {
				for (const key of [...map.keys()]) {
					if (key.startsWith(`${userId}#`)) map.delete(key);
				}
			}
		},
	};
}
