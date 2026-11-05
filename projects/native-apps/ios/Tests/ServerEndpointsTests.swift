import XCTest
@testable import Readplace

final class ServerEndpointsTests: XCTestCase {
	func testEveryEndpointKeepsItsExactURLInEveryEnvironment() {
		for environment in [ServerEnvironment.production, .staging, .local] {
			let endpoints = ServerEndpoints(origin: URL(string: environment.baseURL)!)

			XCTAssertEqual(endpoints.authorize.absoluteString, "\(environment.baseURL)/oauth/authorize")
			XCTAssertEqual(endpoints.token.absoluteString, "\(environment.baseURL)/oauth/token")
			XCTAssertEqual(endpoints.revoke.absoluteString, "\(environment.baseURL)/oauth/revoke")
			XCTAssertEqual(
				endpoints.authorizationServerMetadata.absoluteString,
				"\(environment.baseURL)/.well-known/oauth-authorization-server"
			)
			XCTAssertEqual(endpoints.authDiagnostics.absoluteString, "\(environment.baseURL)/diagnostics/auth")
		}
	}

	func testAppConfigBuildsItsEndpointsFromTheServerBaseURL() {
		XCTAssertEqual(AppConfig.serverEndpoints, ServerEndpoints(origin: URL(string: AppConfig.serverBaseURL)!))
	}
}
