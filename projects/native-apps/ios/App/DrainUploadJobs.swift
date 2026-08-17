import Foundation

@MainActor
struct DrainUploadJobs {
	let api: ReadplaceAPI
	let captor: HTMLCapturing
	let jobs: UploadJobStore
	var now: () -> Date = Date.init

	private static let pdfMediaType = "application/pdf"
	private static let pdfMagic = Data("%PDF-".utf8)

	func run() async {
		jobs.removeOrphanedBytes()
		let due = jobs.loadAll(now: now())
		guard !due.isEmpty else { return }
		guard let page = try? await api.loadQueue() else { return }
		guard let action = page.action(named: "save-content") else {
			for job in due { jobs.remove(job) }
			return
		}
		for job in due where !Task.isCancelled {
			guard await upload(job, through: action) else { return }
		}
	}

	private func upload(_ job: UploadJob, through action: SirenAction) async -> Bool {
		var current = job
		do {
			guard let (ready, contentType) = try await readied(job) else {
				jobs.remove(job)
				return true
			}
			current = ready
			let body = try Data(contentsOf: jobs.bytesURL(for: ready))
			try await api.saveContent(action: action, contentType: contentType, body: body)
			jobs.remove(ready)
		} catch APIError.unauthorized, APIError.noToken {
			return false
		} catch APIError.refused {
			jobs.remove(current)
		} catch APIError.server(let status, _, _) where (400..<500).contains(status) {
			jobs.remove(current)
		} catch {
			reschedule(current)
		}
		return true
	}

	private func readied(_ job: UploadJob) async throws -> (job: UploadJob, contentType: String)? {
		switch job.state {
		case .ready(let contentType):
			return (job, contentType)
		case .capturePending(let detectedMediaType):
			guard let url = URL(string: job.url),
				let form = await content(of: job, at: url, detectedMediaType: detectedMediaType)
			else { return nil }
			return (try await jobs.stageReady(job, form: form), form.contentType)
		}
	}

	private func content(of job: UploadJob, at url: URL, detectedMediaType: String?) async -> MultipartForm? {
		if detectedMediaType == Self.pdfMediaType {
			guard let bytes = await api.fetchExternalContent(url), bytes.starts(with: Self.pdfMagic) else { return nil }
			return saveContentForm(url: url, bytes: bytes, mediaType: Self.pdfMediaType, title: job.title)
		}
		let captured = await captor.capture(url: url)
		guard let html = captured.rawHtml, !html.isEmpty else { return nil }
		let title = (captured.title?.isEmpty == false) ? captured.title : job.title
		return saveContentForm(url: url, bytes: Data(html.utf8), mediaType: "text/html", title: title)
	}

	private func reschedule(_ job: UploadJob) {
		guard let retried = job.retried(now: now()) else { return jobs.remove(job) }
		try? jobs.update(retried)
	}
}
