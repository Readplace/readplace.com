export function buildSignupResumeUrl(params: {
	origin: string;
	email: string;
}): string {
	return `${params.origin}/signup?email=${encodeURIComponent(params.email)}&utm_source=recovery`;
}
