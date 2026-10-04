import type { PublishSubmitLink } from "@packages/provider-contracts/events";

export type InMemorySubmitLink = {
	publishSubmitLink: PublishSubmitLink;
	submitLinks: Parameters<PublishSubmitLink>[0][];
};

export function initInMemorySubmitLink(): InMemorySubmitLink {
	const submitLinks: Parameters<PublishSubmitLink>[0][] = [];
	return {
		submitLinks,
		publishSubmitLink: async (params) => {
			submitLinks.push(params);
		},
	};
}
