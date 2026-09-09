import SwiftUI

enum SharedArticlesDrop: Hashable {
	case always(label: String)
	case ticked(Readlist)
	case unticked(Readlist)

	init(readlist: Readlist, mainlineHref: String?, tickedHrefs: Set<String>) {
		if readlist.href == mainlineHref {
			self = .always(label: readlist.label)
		} else if tickedHrefs.contains(readlist.href) {
			self = .ticked(readlist)
		} else {
			self = .unticked(readlist)
		}
	}

	static func firstAsk(readlists: [Readlist], mainlineHref: String?) -> [SharedArticlesDrop] {
		readlists.map { SharedArticlesDrop(readlist: $0, mainlineHref: mainlineHref, tickedHrefs: []) }
	}

	var label: String {
		switch self {
		case .always(let label): return label
		case .ticked(let readlist), .unticked(let readlist): return readlist.label
		}
	}

	var choice: Readlist? {
		switch self {
		case .always: return nil
		case .ticked(let readlist), .unticked(let readlist): return readlist
		}
	}

	var showsTick: Bool {
		switch self {
		case .always, .ticked: return true
		case .unticked: return false
		}
	}
}

enum SharedArticlesDropPresentation {
	static func title(for drop: SharedArticlesDrop) -> String {
		drop.showsTick ? "Shared articles drop here" : "Want shared article to drop here?"
	}

	static func boxSystemImage(for drop: SharedArticlesDrop) -> String {
		drop.showsTick ? "checkmark.square.fill" : "square"
	}

	static func boxTint(for drop: SharedArticlesDrop) -> Color {
		drop.showsTick ? .brandSuccessText : .brandTextSecondary
	}

	static func titleTint(for drop: SharedArticlesDrop) -> Color {
		drop.showsTick ? .brandTextPrimary : .brandTextSecondary
	}

	static func lockSystemImage(for drop: SharedArticlesDrop) -> String? {
		drop.choice == nil ? "lock.fill" : nil
	}

	static func borderOpacity(for drop: SharedArticlesDrop) -> Double {
		drop.showsTick ? 1 : 0.35
	}

	static func accessibilityTraits(for drop: SharedArticlesDrop) -> AccessibilityTraits {
		drop.showsTick ? [.isButton, .isSelected] : .isButton
	}

	static func explanation(for drop: SharedArticlesDrop) -> String? {
		guard drop.choice == nil else { return nil }
		return "Articles always drop on \(drop.label). Reading one marks as read in all readlists."
	}
}
