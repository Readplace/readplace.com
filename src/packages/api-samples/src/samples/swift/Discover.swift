import Foundation

let sirenMediaType = "application/vnd.siren+json"

struct ReadplaceAction: Decodable {
	let name: String
	let href: String
	let method: String
	let type: String?
}

struct ReadplaceCollection: Decodable {
	let actions: [ReadplaceAction]
}

enum ReadplaceAPIError: Error, Equatable {
	case unresolvableURL(String)
	case unexpectedStatus(Int)
	case missingAction(String)
}

final class HeadersPreservingRedirects: NSObject, URLSessionTaskDelegate {
	func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
		var redirected = request
		for (name, value) in task.originalRequest?.allHTTPHeaderFields ?? [:] {
			redirected.setValue(value, forHTTPHeaderField: name)
		}
		return redirected
	}
}

func sirenRequest(url: URL, token: String) -> URLRequest {
	var request = URLRequest(url: url)
	request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
	request.setValue(sirenMediaType, forHTTPHeaderField: "Accept")
	return request
}

func discover(origin: URL, token: String, session: URLSession = .shared) async throws -> ReadplaceCollection {
	guard let entryPoint = URL(string: "/", relativeTo: origin) else {
		throw ReadplaceAPIError.unresolvableURL("/")
	}
	let (data, response) = try await session.data(for: sirenRequest(url: entryPoint, token: token), delegate: HeadersPreservingRedirects())
	guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
		throw ReadplaceAPIError.unexpectedStatus((response as? HTTPURLResponse)?.statusCode ?? 0)
	}
	return try JSONDecoder().decode(ReadplaceCollection.self, from: data)
}
