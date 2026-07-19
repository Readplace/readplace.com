const AVATAR_COLORS = [
	"#6366F1",
	"#8B5CF6",
	"#EC4899",
	"#F59E0B",
	"#10B981",
	"#3B82F6",
	"#EF4444",
	"#14B8A6",
	"#F97316",
	"#06B6D4",
];

export function avatarColor(domain: string): string {
	let hash = 0;
	for (let i = 0; i < domain.length; i++) {
		hash = (hash * 31 + domain.charCodeAt(i)) | 0;
	}
	return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
