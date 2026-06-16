import { buildDnsAidRecords } from "./dns-aid";

describe("buildDnsAidRecords", () => {
	it("publishes a single _index._agents SVCB entrypoint and no _a2a record", () => {
		const records = buildDnsAidRecords("readplace.com");
		expect(records).toHaveLength(1);
		expect(records[0].name).toBe("_index._agents.readplace.com");
		expect(records[0].type).toBe("SVCB");
		expect(records.some((r) => r.name.includes("_a2a"))).toBe(false);
	});

	it("targets the domain's own HTTPS origin over HTTP/2 on 443 in ServiceMode", () => {
		const [record] = buildDnsAidRecords("readplace.com");
		expect(record.value).toBe('1 readplace.com alpn="h2" port=443');
		expect(record.ttlSeconds).toBe(3600);
	});

	it("binds every label to the supplied domain so each apex points at itself", () => {
		const [record] = buildDnsAidRecords("hutch-app.com");
		expect(record.name).toBe("_index._agents.hutch-app.com");
		expect(record.value).toBe('1 hutch-app.com alpn="h2" port=443');
	});

	it("refuses to build records without a domain", () => {
		expect(() => buildDnsAidRecords("")).toThrow("DNS-AID records require a domain");
	});
});
