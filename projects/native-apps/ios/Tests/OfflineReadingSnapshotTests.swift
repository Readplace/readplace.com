import SwiftUI
import UIKit
import XCTest

@testable import Readplace

@MainActor
final class OfflineReadingSnapshotTests: XCTestCase {
	private static let width = 390.0

	private static let checkpoints: [(name: String, style: UIUserInterfaceStyle)] = [
		("article-row", .light),
		("article-row-offline", .light),
		("article-row-offline", .dark),
		("download-running", .light),
		("download-resume", .light),
		("download-resume", .dark),
		("offline-list", .light),
		("offline-empty", .light),
	]

	func testARowWithoutAStoredCopyLooksRight() {
		let view = mount(rows([article(id: "a1", title: "A long read about tides")], offline: []))

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "article-row", style: .light)
	}

	func testARowWithAStoredCopyCarriesTheOfflineBadge() {
		let view = mount(rows([article(id: "a1", title: "A long read about tides")], offline: ["a1"]))

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "article-row-offline", style: .light)
	}

	func testARowWithAStoredCopyCarriesTheOfflineBadgeInDarkMode() {
		let view = mount(rows([article(id: "a1", title: "A long read about tides")], offline: ["a1"]))

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "article-row-offline", style: .dark)
	}

	func testARunningDownloadShowsItsCountFromTheStart() {
		let view = mount(
			OfflineDownloadRow(
				state: .running(OfflineDownloadProgress(completed: 0, total: 1296, failed: 0)),
				onContinue: {},
				onDismiss: {}
			)
		)

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "download-running", style: .light)
	}

	func testAStoppedDownloadOffersToContinue() {
		let view = mount(resumeRow())

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "download-resume", style: .light)
	}

	func testAStoppedDownloadOffersToContinueInDarkMode() {
		let view = mount(resumeRow())

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "download-resume", style: .dark)
	}

	func testTheListKeptForOfflineShowsUnderTheOfflineBanner() {
		let articles = [
			article(id: "a1", title: "A long read about tides"),
			article(id: "a2", title: "Notes on slow software"),
			article(id: "a3", title: "Why maps lie"),
		]
		let view = mount(
			VStack(spacing: 0) {
				rows(articles, offline: ["a1", "a3"])
				ListBanner(text: OfflineReading.bannerText, tone: BannerTone(errorText: OfflineReading.bannerText)) {}
			}
		)

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "offline-list", style: .light)
	}

	func testAnEmptyListOfflineSaysItIsOfflineRatherThanEmpty() {
		let view = mount(
			VStack(spacing: 0) {
				ReadingListEmptyState(isOffline: true)
				ListBanner(text: OfflineReading.bannerText, tone: BannerTone(errorText: OfflineReading.bannerText)) {}
			}
		)

		assertHostIsNeutral()
		assertMatchesBaseline(view, checkpoint: "offline-empty", style: .light)
	}

	func testEveryCheckpointHasABaselineForEveryRuntimeAlreadyCovered() {
		let directory = CardCheckpoint.baselineDirectory(for: #filePath)
		let committed = Set(CardCheckpoint.committedNames(in: directory))
		let runtimes = CardCheckpoint.coveredRuntimes(in: directory)

		XCTAssertFalse(
			runtimes.isEmpty,
			"the snapshot directory holds no baselines at all; mint them with make test RECORD_SNAPSHOTS=1"
		)
		for runtime in runtimes {
			for checkpoint in Self.checkpoints {
				let name = CardCheckpoint.baselineName(checkpoint.name, checkpoint.style, runtime: runtime)
				XCTAssertTrue(
					committed.contains(name),
					"\(name) is missing while \(runtime) has other baselines; a runtime refreshed alone leaves the rest stale"
				)
			}
		}
	}

	// MARK: - Helpers

	private func resumeRow() -> OfflineDownloadRow {
		OfflineDownloadRow(
			state: .resumable(OfflineDownloadRun(total: 1296, completed: 312)),
			onContinue: {},
			onDismiss: {}
		)
	}

	private func article(id: String, title: String) -> Article {
		Article(
			id: id,
			url: "https://example.com/\(id)",
			title: title,
			siteName: "Example",
			excerpt: "An excerpt long enough to wrap onto a second line in the row so the layout shows its real height.",
			imageURL: nil,
			readTimeLabel: "~6 min read",
			isRead: false,
			savedAt: nil,
			contentVersion: "v1",
			actions: [],
			links: [],
			readHref: "/queue/\(id)/view"
		)
	}

	private func rows(_ articles: [Article], offline: Set<String>) -> some View {
		VStack(spacing: 0) {
			ForEach(articles) { article in
				ArticleRow(
					article: article,
					edge: ListingPanelEdge(of: article, in: articles),
					isAvailableOffline: offline.contains(article.id)
				)
			}
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 12)
	}

	private func mount<Content: View>(_ content: Content) -> UIView {
		let host = UIHostingController(
			rootView: content
				.fixedSize(horizontal: false, vertical: true)
				.frame(width: Self.width)
				.background(Color.brandSurface)
				.tint(.brandAmber)
		)
		let size = host.sizeThatFits(in: CGSize(width: Self.width, height: .greatestFiniteMagnitude))
		let window = UIWindow(frame: CGRect(x: 0, y: 0, width: Self.width, height: 1200))
		let root = UIViewController()
		window.rootViewController = root
		root.addChild(host)
		host.view.frame = CGRect(x: 0, y: 300, width: Self.width, height: ceil(size.height))
		root.view.addSubview(host.view)
		host.didMove(toParent: root)
		window.makeKeyAndVisible()
		window.layoutIfNeeded()
		mounted.append(window)
		return host.view
	}

	private var mounted: [UIWindow] = []
}
