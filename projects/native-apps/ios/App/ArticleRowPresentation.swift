import SwiftUI

struct ArticleRowPresentation: Equatable {
	enum Marker: Equatable {
		case unreadDot
		case readCheck
	}

	static let thumbnailSize = CGSize(width: 72, height: 54)
	static let thumbnailCornerRadius: CGFloat = 8
	static let offlineBadgeLabel = "Saved offline"

	let marker: Marker
	let markerColor: Color
	let statusLabel: String
	let titleColor: Color
	let fill: Color
	let metaText: String?
	let showsOfflineBadge: Bool
	let processingLabel: String?
	let noticeText: String?
	private let estimate: CrawlEstimate?
	private let processingReceivedAt: Date?

	init(
		isRead: Bool,
		readTimeLabel: String?,
		savedLabel: String?,
		isAvailableOffline: Bool,
		processing: ArticleProcessing? = nil,
		processingReceivedAt: Date? = nil,
		notice: String? = nil
	) {
		marker = isRead ? .readCheck : .unreadDot
		markerColor = isRead ? .brandSuccessText : .brandPrimaryText
		statusLabel = isRead ? "Read" : "Unread"
		titleColor = isRead ? .brandTextSecondary : .brandTextPrimary
		fill = isRead ? .brandCard : .brandSecondary
		let parts = [readTimeLabel, savedLabel].compactMap { $0 }.filter { !$0.isEmpty }
		metaText = parts.isEmpty || processing != nil ? nil : parts.joined(separator: " · ")
		showsOfflineBadge = isAvailableOffline
		processingLabel = processing?.label
		noticeText = notice
		estimate = processing?.estimate
		self.processingReceivedAt = processingReceivedAt
	}

	func estimateText(now: Date) -> String? {
		guard let estimate, let processingReceivedAt else { return nil }
		let elapsed = max(0, Int(now.timeIntervalSince(processingReceivedAt).rounded(.down)))
		switch estimate {
		case let .quiet(revealInSeconds, seconds):
			return elapsed < revealInSeconds ? nil : Self.remainingLabel(seconds - elapsed)
		case let .counting(seconds):
			return Self.remainingLabel(seconds - elapsed)
		case .almostThere:
			return Self.almostThereLabel
		}
	}

	private static let almostThereLabel = "Almost there…"

	private static func remainingLabel(_ seconds: Int) -> String {
		seconds > 0 ? "~\(seconds) s left" : almostThereLabel
	}
}
