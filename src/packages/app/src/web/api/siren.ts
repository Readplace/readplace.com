interface SirenField {
	name: string;
	type: string;
	value?: string | number;
}

export interface SirenAction {
	name: string;
	href: string;
	method: string;
	type?: string;
	fields?: SirenField[];
}

export interface SirenLink {
	rel: string[];
	href: string;
}

export interface SirenEntity {
	class?: string[];
	properties?: Record<string, unknown>;
	entities?: SirenSubEntity[];
	links?: SirenLink[];
	actions?: SirenAction[];
}

export interface SirenSubEntity extends SirenEntity {
	rel: string[];
}

export const SIREN_MEDIA_TYPE = "application/vnd.siren+json";

export function sirenError(error: {
	code: string;
	message: string;
	actions?: SirenAction[];
}): SirenEntity {
	const entity: SirenEntity = {
		class: ["error"],
		properties: { code: error.code, message: error.message },
	};
	if (error.actions) entity.actions = error.actions;
	return entity;
}
