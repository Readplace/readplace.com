import { AUTH_DIAGNOSTIC_LIMITS, type AuthDiagnosticEvent } from "@packages/domain/auth-diagnostics";
import { z } from "zod";
import type { AuthState, AuthStateStore, DiagnosticEntry } from "./auth-state.types";

type Detail = Pick<AuthDiagnosticEvent, "event"> & Partial<Omit<AuthDiagnosticEvent, "event" | "event_id" | "occurred_at" | "client" | "context_id" | "client_version">>;
const Ack = z.object({ accepted_event_ids: z.array(z.uuid()) });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function initAuthJournal(deps: {
	store: AuthStateStore;
	client: "chrome" | "firefox";
	version: string;
	contextId: string;
	now: () => number;
	uuid: () => string;
	fetchFn: typeof fetch;
}) {
	function record(state: AuthState, detail: Detail, owner: Pick<AuthState, "epoch" | "permit"> = state): void {
		const event: AuthDiagnosticEvent = {
			event_id: deps.uuid(), occurred_at: new Date(deps.now()).toISOString(),
			client: deps.client, surface: "background", context_id: deps.contextId, client_version: deps.version, ...detail,
		};
		state.journal = state.journal.filter(entry => Date.parse(entry.event.occurred_at) >= deps.now() - AUTH_DIAGNOSTIC_LIMITS.journalAgeMs);
		state.journal.push({ event, epoch: owner.epoch, permit: owner.permit });
		let dropped = 0;
		const health: DiagnosticEntry = { epoch: owner.epoch, permit: owner.permit, event: { ...event, event_id: deps.uuid(), event: "journal_health", reason: "journal_overflow", dropped_events: 0 } };
		while (state.journal.length > AUTH_DIAGNOSTIC_LIMITS.journalEvents || bytes(state.journal) > AUTH_DIAGNOSTIC_LIMITS.journalBytes) {
			state.journal.shift();
			dropped++;
			if (dropped === 1) state.journal.push(health);
			health.event.dropped_events = dropped;
		}
	}
	async function send(): Promise<void> {
		const state = await deps.store.read();
		if (!state.diagnosticsEndpoint) return;
		const first = state.journal.find(entry => entry.permit && Date.parse(entry.event.occurred_at) >= deps.now() - AUTH_DIAGNOSTIC_LIMITS.journalAgeMs);
		if (!first?.permit) return;
		const batch: DiagnosticEntry[] = [];
		for (const entry of state.journal) {
			if (entry.permit !== first.permit) continue;
			if (Date.parse(entry.event.occurred_at) < deps.now() - AUTH_DIAGNOSTIC_LIMITS.journalAgeMs) continue;
			const candidate = [...batch, entry];
			if (candidate.length > AUTH_DIAGNOSTIC_LIMITS.batchEvents || bytes({ schema_version: 1, events: candidate.map(item => item.event) }) > AUTH_DIAGNOSTIC_LIMITS.batchBytes) break;
			batch.push(entry);
		}
		const response = await deps.fetchFn(state.diagnosticsEndpoint, {
			method: "POST", headers: { Authorization: `Bearer ${first.permit}`, "Content-Type": "application/json" },
			body: JSON.stringify({ schema_version: 1, events: batch.map(entry => entry.event) }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) return;
		const ack = Ack.safeParse(await response.json());
		if (!ack.success) return;
		const sent = new Set(batch.map(entry => entry.event.event_id));
		const accepted = new Set(ack.data.accepted_event_ids.filter(id => sent.has(id)));
		await deps.store.update(current => { current.journal = current.journal.filter(entry => !accepted.has(entry.event.event_id)); });
	}
	let uploading: Promise<void> | undefined;
	return {
		record,
		write: (detail: Detail, owner?: Pick<AuthState, "epoch" | "permit">) => deps.store.update(state => record(state, detail, owner)),
		flush(): Promise<void> {
			uploading ??= send().catch(() => {}).finally(() => { uploading = undefined; });
			return uploading;
		},
	};
}
