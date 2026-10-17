export interface RefreshExemption {
	atEpoch: number;
	grantId: string;
	grantEpoch: number;
}

export interface RefreshAccount {
	epoch: number;
	exemption: RefreshExemption | undefined;
}

export function isCurrentGrant(input: { account: RefreshAccount; credential: { grantId: string | undefined; epoch: number } }): boolean {
	const { account, credential } = input;
	if (credential.epoch === account.epoch) return true;
	const exemption = account.exemption;
	if (!exemption || exemption.atEpoch !== account.epoch) return false;
	return exemption.grantId === credential.grantId && exemption.grantEpoch === credential.epoch;
}
