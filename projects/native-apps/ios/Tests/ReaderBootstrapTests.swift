import Foundation
import XCTest

@testable import Readplace

final class ReaderBootstrapTests: XCTestCase {
	func testAMintedSessionIsReadyWithItsCookies() throws {
		let cookie = try XCTUnwrap(HTTPCookie(properties: [
			.name: "hutch_sid", .value: "sess-xyz", .domain: "readplace.com", .path: "/",
		]))

		XCTAssertEqual(ReaderBootstrap(after: .minted([cookie])), .ready([cookie]))
	}

	func testAFailedMintIsUnavailable() {
		XCTAssertEqual(ReaderBootstrap(after: .failed), .unavailable)
	}

	func testASupersededMintStaysLoadingSoTheNextAppearanceRetries() {
		XCTAssertEqual(
			ReaderBootstrap(after: .superseded), .loading,
			"a mint cancelled by an article switch must leave the bootstrap retryable, not \"Couldn't open the reader\""
		)
	}

	func testAMintThatCouldNotReachTheServerOpensTheReaderOffline() {
		XCTAssertEqual(ReaderBootstrap(after: .offline), .offline)
	}

	func testAnOfflineReaderLoadsTheStoredCopy() {
		XCTAssertEqual(ReaderBootstrap.offline.cachePolicy, .returnCacheDataElseLoad)
	}

	func testAReadyReaderLoadsFromTheServer() {
		XCTAssertEqual(ReaderBootstrap.ready([]).cachePolicy, .useProtocolCachePolicy)
	}

	func testAnOnlineReaderPageLoadAsksTheServerEveryTime() throws {
		let url = try XCTUnwrap(URL(string: "https://readplace.com/queue/a1/view?platform=ios"))

		XCTAssertEqual(
			ReaderRequest.open(url: url, cachePolicy: ReaderBootstrap.ready([]).cachePolicy).cachePolicy, .useProtocolCachePolicy,
			"the server marks the reader private, no-cache, so the default policy revalidates every online open and a stored copy never stands in for a reachable server"
		)
	}

	func testAReaderPageLoadGivesUpAfterTenSilentSecondsSoAStalledConnectionFallsBackToTheStoredCopy() throws {
		let url = try XCTUnwrap(URL(string: "https://readplace.com/queue/a1/view?platform=ios"))

		let requests = [ReaderBootstrap.ready([]), .offline].map { ReaderRequest.open(url: url, cachePolicy: $0.cachePolicy) }

		XCTAssertEqual(requests.map(\.url), [url, url])
		XCTAssertEqual(requests.map(\.cachePolicy), [.useProtocolCachePolicy, .returnCacheDataElseLoad])
		XCTAssertEqual(requests.map(\.timeoutInterval), [10, 10])
	}

	func testAReaderReopenedAfterItsConnectionDroppedLoadsTheStoredCopy() {
		XCTAssertEqual(ReaderBootstrap.ready([]).cachePolicy(reopenedFromCache: true), .returnCacheDataElseLoad)
	}

	func testAReaderNotReopenedKeepsTheBootstrapsPolicy() {
		XCTAssertEqual(
			[ReaderBootstrap.ready([]), .offline].map { $0.cachePolicy(reopenedFromCache: false) },
			[.useProtocolCachePolicy, .returnCacheDataElseLoad]
		)
	}

	func testAnOfflineReaderShowsTheBannerFromTheStart() {
		XCTAssertEqual(ReaderBootstrap.offline.showsOfflineBanner(fellBackToCache: false), true)
	}

	func testAReadyReaderShowsTheBannerOnceItsLoadFellBackToTheStoredCopy() {
		XCTAssertEqual(ReaderBootstrap.ready([]).showsOfflineBanner(fellBackToCache: true), true)
	}

	func testAReadyReaderThatLoadedFromTheServerShowsNoBanner() {
		XCTAssertEqual(ReaderBootstrap.ready([]).showsOfflineBanner(fellBackToCache: false), false)
	}

	func testTheReaderURLIsTheReadHrefResolvedWithThePlatformParam() {
		XCTAssertEqual(
			ReaderRequest.url(readHref: "/queue/a1/view", baseURL: "https://readplace.com")?.absoluteString,
			"https://readplace.com/queue/a1/view?platform=ios"
		)
	}

	func testTheReaderURLKeepsTheQueryTheServerPutOnTheReadHref() {
		XCTAssertEqual(
			ReaderRequest.url(readHref: "/queue/a1/view?readlist=work", baseURL: "https://readplace.com")?.absoluteString,
			"https://readplace.com/queue/a1/view?readlist=work&platform=ios"
		)
	}

	func testAnArticleWithoutAReadHrefHasNoReaderURL() {
		XCTAssertEqual(ReaderRequest.url(readHref: nil, baseURL: "https://readplace.com"), nil)
	}

	func testAForeignSchemeReadHrefHasNoReaderURL() {
		XCTAssertEqual(ReaderRequest.url(readHref: "mailto:hi@example.com", baseURL: "https://readplace.com"), nil)
	}

	func testAPrefetchRequestsTheReaderURLAndSaysItIsAPrefetch() throws {
		let request = try XCTUnwrap(
			ReaderRequest.prefetch(readHref: "/queue/a1/view?readlist=work", baseURL: "https://readplace.com")
		)

		XCTAssertEqual(request.url?.absoluteString, "https://readplace.com/queue/a1/view?readlist=work&platform=ios")
		XCTAssertEqual(request.value(forHTTPHeaderField: "Sec-Purpose"), "prefetch")
	}

	func testAnArticleWithoutAReadHrefHasNothingToPrefetch() {
		XCTAssertEqual(ReaderRequest.prefetch(readHref: nil, baseURL: "https://readplace.com"), nil)
	}
}
