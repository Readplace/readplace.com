import { isCurrentGrant, isExemptGrant } from "./current-grant";

const exemption = { atEpoch: 2, grantId: "kept", grantEpoch: 1 };

it.each([
	{ title: "current by epoch", account: { epoch: 2, exemption: undefined }, credential: { grantId: "kept", epoch: 2 }, current: true },
	{ title: "current by epoch without a grant id", account: { epoch: 0, exemption: undefined }, credential: { grantId: undefined, epoch: 0 }, current: true },
	{ title: "current through a live exemption", account: { epoch: 2, exemption }, credential: { grantId: "kept", epoch: 1 }, current: true },
	{ title: "behind the epoch with no exemption", account: { epoch: 2, exemption: undefined }, credential: { grantId: "kept", epoch: 1 }, current: false },
	{ title: "another grant", account: { epoch: 2, exemption }, credential: { grantId: "other", epoch: 1 }, current: false },
	{ title: "another grant epoch", account: { epoch: 2, exemption }, credential: { grantId: "kept", epoch: 0 }, current: false },
	{ title: "no grant id", account: { epoch: 2, exemption }, credential: { grantId: undefined, epoch: 1 }, current: false },
	{ title: "a stranded exemption", account: { epoch: 3, exemption }, credential: { grantId: "kept", epoch: 1 }, current: false },
])("$title", ({ account, credential, current }) => {
	expect(isCurrentGrant({ account, credential })).toBe(current);
});

it.each([
	{ title: "exempts the grant a live exemption names", account: { epoch: 2, exemption }, grantId: "kept", exempt: true },
	{ title: "does not exempt another grant", account: { epoch: 2, exemption }, grantId: "other", exempt: false },
	{ title: "does not exempt through a stranded exemption", account: { epoch: 3, exemption }, grantId: "kept", exempt: false },
	{ title: "does not exempt without an exemption", account: { epoch: 2, exemption: undefined }, grantId: "kept", exempt: false },
])("$title", ({ account, grantId, exempt }) => {
	expect(isExemptGrant({ account, grantId })).toBe(exempt);
});
