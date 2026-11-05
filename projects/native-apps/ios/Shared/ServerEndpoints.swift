import Foundation

struct ServerEndpoints: Equatable {
	let origin: URL
	var authorize: URL { origin.appendingPathComponent("oauth/authorize") }
	var token: URL { origin.appendingPathComponent("oauth/token") }
	var revoke: URL { origin.appendingPathComponent("oauth/revoke") }
	var authorizationServerMetadata: URL { origin.appendingPathComponent(".well-known/oauth-authorization-server") }
	var authDiagnostics: URL { origin.appendingPathComponent("diagnostics/auth") }
}
