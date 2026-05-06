import { Base } from "./base.component";
import type { BannerStateSource } from "./banner-state";
import { bannerStateFromRequest } from "./banner-state";
import type { Component } from "./component.types";
import type { PageBody } from "./page-body.types";

export function renderPage(source: BannerStateSource, body: PageBody): Component {
	return Base(body, bannerStateFromRequest(source));
}
