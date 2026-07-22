import AuthenticationServices

/// Maps `ASWebAuthenticationSession`'s `(URL?, Error?)` completion onto the flow's
/// outcome. The user dismissing the sheet arrives as `canceledLogin` and maps to
/// `.dismissed`; a completion carrying neither a callback nor an error cannot be
/// distinguished from a presentation that never ran, so it is reported as one.
func authPresentationOutcome(callbackURL: URL?, error: Error?) -> Result<WebAuthPresentation, Error> {
	if let callbackURL { return .success(.returned(callbackURL: callbackURL)) }
	if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { return .success(.dismissed) }
	return .failure(error ?? AuthFlowError.presentationFailed)
}
