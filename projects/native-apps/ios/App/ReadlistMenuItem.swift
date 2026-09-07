import SwiftUI

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
		shareTargetHrefs: Set<String>
	) -> [ReadlistMenuItem] {
		readlists.map { readlist in
			ReadlistMenuItem(
				label: readlist.label,
				href: readlist.href,
				isSelected: readlist.href == selectedHref,
				isShareTarget: shareTargetHrefs.contains(readlist.href)
			)
		}
	}
}

enum SharedArticlesDropPresentation {
	static func title(isOn: Bool) -> String {
		isOn ? "Shared articles drop here" : "Want shared article to drop here?"
	}

	static func boxSystemImage(isOn: Bool) -> String {
		isOn ? "checkmark.square.fill" : "square"
	}

	static func boxTint(isOn: Bool) -> Color {
		isOn ? .brandSuccessText : .brandTextSecondary
	}

	static func titleTint(isOn: Bool) -> Color {
		isOn ? .brandTextPrimary : .brandTextSecondary
	}
}
