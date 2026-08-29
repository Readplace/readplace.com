import SwiftUI

struct ArticleRowPresentation: Equatable {
	enum Marker: Equatable {
		case unreadDot
		case readCheck
	}

	static let thumbnailSize = CGSize(width: 72, height: 54)
	static let thumbnailCornerRadius: CGFloat = 8

	let marker: Marker
	let markerColor: Color
	let statusLabel: String
	let titleColor: Color
	let fill: Color
	let metaText: String?

	init(isRead: Bool, readTimeLabel: String?, savedLabel: String?) {
		marker = isRead ? .readCheck : .unreadDot
		markerColor = isRead ? .brandSuccessText : .brandPrimaryText
		statusLabel = isRead ? "Read" : "Unread"
		titleColor = isRead ? .brandTextSecondary : .brandTextPrimary
		fill = isRead ? .brandCard : .brandSecondary
		let parts = [readTimeLabel, savedLabel].compactMap { $0 }.filter { !$0.isEmpty }
		metaText = parts.isEmpty ? nil : parts.joined(separator: " · ")
	}
}
