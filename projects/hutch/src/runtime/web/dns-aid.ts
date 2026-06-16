import assert from "node:assert";

/**
 * DNS for AI Discovery (DNS-AID, draft-mozleywilliams-dnsop-dnsaid) entrypoint
 * records. The `_agents` namespace lets an agent discover where a domain's agent
 * surface lives straight from DNS, before any HTTP round-trip. We point `_index`
 * at the apex that already serves that surface over HTTPS — the
 * `.well-known/agent-skills` index, the OAuth metadata, and the api-catalog.
 */

const DNS_AID_TTL_SECONDS = 3600;

export interface DnsAidRecord {
	readonly name: string;
	readonly type: "SVCB";
	readonly value: string;
	readonly ttlSeconds: number;
}

/**
 * One ServiceMode SVCB record (RFC 9460) per domain. We publish `_index` only —
 * not the draft's `_a2a` example — because Readplace answers over HTTPS, not an
 * Agent2Agent JSON-RPC channel, so an `_a2a` target would never connect. `alpn`
 * lists `h2` alone: RFC 9460 §7.1.1 folds in the https default (`http/1.1`)
 * automatically, and the API Gateway custom domains fronting the apexes do not
 * serve `h3`. The value is Route 53 SVCB presentation format; the draft's
 * `mandatory` and `keyNNNNN` SvcParams are left out because Route 53 rejects them.
 */
export function buildDnsAidRecords(domain: string): readonly DnsAidRecord[] {
	assert(domain.length > 0, "DNS-AID records require a domain");
	return [
		{
			name: `_index._agents.${domain}`,
			type: "SVCB",
			value: `1 ${domain} alpn="h2" port=443`,
			ttlSeconds: DNS_AID_TTL_SECONDS,
		},
	];
}
