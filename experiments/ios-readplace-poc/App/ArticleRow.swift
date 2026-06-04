import SwiftUI

struct ArticleRow: View {
	let article: Article

	var body: some View {
		HStack(alignment: .top, spacing: 12) {
			thumbnail

			VStack(alignment: .leading, spacing: 4) {
				Text(article.title)
					.font(.headline)
					.lineLimit(2)

				if let subtitle {
					Text(subtitle)
						.font(.caption)
						.foregroundStyle(.secondary)
						.lineLimit(1)
				}

				if let excerpt = article.excerpt, !excerpt.isEmpty {
					Text(excerpt)
						.font(.subheadline)
						.foregroundStyle(.secondary)
						.lineLimit(2)
				}
			}

			if article.isRead {
				Image(systemName: "checkmark.circle.fill")
					.foregroundStyle(.green)
					.font(.footnote)
			}
		}
		.padding(.vertical, 4)
	}

	@ViewBuilder
	private var thumbnail: some View {
		if let imageURL = article.imageURL {
			AsyncImage(url: imageURL) { phase in
				switch phase {
				case .success(let image):
					image.resizable().aspectRatio(contentMode: .fill)
				default:
					placeholder
				}
			}
			.frame(width: 64, height: 64)
			.clipShape(RoundedRectangle(cornerRadius: 8))
		} else {
			placeholder
				.frame(width: 64, height: 64)
				.clipShape(RoundedRectangle(cornerRadius: 8))
		}
	}

	private var placeholder: some View {
		ZStack {
			Color(.secondarySystemBackground)
			Image(systemName: "doc.text")
				.foregroundStyle(.tertiary)
		}
	}

	private var subtitle: String? {
		var parts: [String] = []
		if let site = article.siteName, !site.isEmpty { parts.append(site) }
		if let minutes = article.readTimeMinutes, minutes > 0 { parts.append("\(minutes) min read") }
		if let savedAt = article.savedAt { parts.append(Self.relative.localizedString(for: savedAt, relativeTo: Date())) }
		return parts.isEmpty ? nil : parts.joined(separator: " · ")
	}

	private static let relative: RelativeDateTimeFormatter = {
		let formatter = RelativeDateTimeFormatter()
		formatter.unitsStyle = .abbreviated
		return formatter
	}()
}
