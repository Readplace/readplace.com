import { renderInFlightDots } from "../in-flight-dots/in-flight-dots.component";

export const TOAST_TEMPLATE = `<div class="toast" tabindex="-1" data-dismiss="{{dismissMs}}" data-test-toast>
	<span class="toast__message" data-test-toast-message>{{message}}</span>
	{{#each actions}}
	<form class="toast__action-form" method="{{method}}" action="{{url}}" hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:none" hx-disabled-elt="find button">
		{{#each fields}}<input type="hidden" name="{{name}}" value="{{value}}">{{/each}}
		<button class="btn btn--primary btn--compact toast__action" type="submit" aria-label="{{label}}" data-test-toast-action><span class="toast__action-label">{{label}}</span>${renderInFlightDots("toast__action-loader")}</button>
	</form>
	{{/each}}
</div>`;
