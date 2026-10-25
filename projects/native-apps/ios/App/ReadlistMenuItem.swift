import Foundation

struct ReadlistMenuItem: Identifiable, Equatable {
	let label: String
	let href: String
	let isSelected: Bool
	let isShareTarget: Bool
	var id: String { href }

	var badgeSystemImage: String {
		isShareTarget ? "square.and.arrow.up" : "list.bullet"
	}

	static func items(
		readlists: [Readlist],
		selectedHref: String?,
		mainlineHref: String?,
		shareTargetHrefs: Set<String>,
		baseURL: String
	) -> [ReadlistMenuItem] {
		readlists.map { readlist in
			ReadlistMenuItem(
				label: readlist.label,
				href: readlist.href,
				isSelected: Href.matches(readlist.href, anyOf: [selectedHref].compactMap { $0 }, baseURL: baseURL),
				isShareTarget: Href.matches(
					readlist.href, anyOf: [mainlineHref].compactMap { $0 } + Array(shareTargetHrefs), baseURL: baseURL
				)
			)
		}
	}
}
