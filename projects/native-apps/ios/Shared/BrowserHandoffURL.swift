import Foundation

func browserHandoffURL(for url: URL, code: String, baseURL: String) -> URL? {
	guard url.host == AppConfig.serverHost, ["http", "https"].contains(url.scheme?.lowercased()),
		let target = URLComponents(url: url, resolvingAgainstBaseURL: false),
		var handoff = URLComponents(string: "\(baseURL)/auth/handoff") else { return nil }
	let path = target.path.isEmpty ? "/" : target.path
	let query = target.query.map { "?\($0)" } ?? ""
	let fragment = target.fragment.map { "#\($0)" } ?? ""
	handoff.queryItems = [
		URLQueryItem(name: "code", value: code),
		URLQueryItem(name: "return", value: path + query + fragment),
	]
	return handoff.url
}
