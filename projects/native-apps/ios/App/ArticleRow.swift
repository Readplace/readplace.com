import SwiftUI

struct ArticleRow: View {
	let article: Article
	let edge: ListingPanelEdge
	@ScaledMetric(relativeTo: .caption) private var dotSize: CGFloat = 8

	var body: some View {
		let presentation = ArticleRowPresentation(
			isRead: article.isRead,
			readTimeLabel: article.readTimeLabel,
			savedLabel: article.savedAt.map { Self.relative.localizedString(for: $0, relativeTo: Date()) }
		)
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 8) {
				marker(presentation)

				if let metaText = presentation.metaText {
					Text(metaText)
						.font(.caption)
						.foregroundStyle(Color.brandTextSecondary)
						.lineLimit(1)
				}
			}

			HStack(alignment: .top, spacing: 0) {
				VStack(alignment: .leading, spacing: 4) {
					Text(article.title)
						.font(.subheadline.weight(.bold))
						.foregroundStyle(presentation.titleColor)
						.lineLimit(2)

					if let excerpt = article.excerpt, !excerpt.isEmpty {
						Text(excerpt)
							.font(.subheadline)
							.foregroundStyle(Color.brandTextSecondary)
							.lineLimit(2)
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)

				if let imageURL = article.imageURL {
					thumbnail(imageURL)
				}
			}
		}
		.padding(12)
		.background(presentation.fill, in: edge.fillShape)
		.padding(edge.borderInsets)
		.background(Color.brandBorder, in: edge.borderShape)
		.listRowInsets(edge.rowInsets)
		.listRowSeparator(.hidden)
		.listRowBackground(Color.clear)
	}

	@ViewBuilder
	private func marker(_ presentation: ArticleRowPresentation) -> some View {
		switch presentation.marker {
		case .unreadDot:
			Circle()
				.fill(presentation.markerColor)
				.frame(width: dotSize, height: dotSize)
				.accessibilityLabel(presentation.statusLabel)
		case .readCheck:
			Image(systemName: "checkmark")
				.font(.caption.weight(.semibold))
				.foregroundStyle(presentation.markerColor)
				.accessibilityLabel(presentation.statusLabel)
		}
	}

	private func thumbnail(_ url: URL) -> some View {
		AsyncImage(url: url) { phase in
			switch phase {
			case .success(let image):
				image
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(width: ArticleRowPresentation.thumbnailSize.width, height: ArticleRowPresentation.thumbnailSize.height)
					.clipShape(RoundedRectangle(cornerRadius: ArticleRowPresentation.thumbnailCornerRadius))
					.padding(.leading, 12)
			case .failure:
				EmptyView()
			default:
				Color.clear
					.frame(width: ArticleRowPresentation.thumbnailSize.width, height: ArticleRowPresentation.thumbnailSize.height)
					.padding(.leading, 12)
			}
		}
	}

	private static let relative: RelativeDateTimeFormatter = {
		let formatter = RelativeDateTimeFormatter()
		formatter.unitsStyle = .abbreviated
		return formatter
	}()
}
