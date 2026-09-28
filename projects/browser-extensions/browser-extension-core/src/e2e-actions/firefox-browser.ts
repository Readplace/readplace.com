import { Options, ServiceBuilder } from "selenium-webdriver/firefox";

export function createFirefoxBrowser(input: { ci: boolean }): {
	options: Options;
	service: ServiceBuilder;
} {
	const options = new Options();
	if (input.ci) options.setBinary("/opt/firefox/firefox");
	return {
		options,
		service: new ServiceBuilder(
			input.ci ? "/opt/geckodriver/geckodriver" : undefined,
		).addArguments("--allow-system-access"),
	};
}
