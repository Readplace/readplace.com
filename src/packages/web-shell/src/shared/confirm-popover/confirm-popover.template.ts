export const CONFIRM_POPOVER_TEMPLATE = `<div class="confirm-popover" id="{{id}}" popover="auto" role="dialog" tabindex="-1" autofocus aria-labelledby="{{id}}-title" aria-describedby="{{describedBy}}" data-test-confirm-popover="{{key}}"{{#if subject}} data-test-confirm-subject="{{subject}}"{{/if}}>
	<div class="confirm-popover__header">
		<h2 class="confirm-popover__title" id="{{id}}-title">{{title}}</h2>
		<button class="confirm-popover__close" type="button" popovertarget="{{id}}" popovertargetaction="hide" data-test-action="{{key}}-dismiss">{{icon "x"}}<span class="sr-only">Close</span></button>
	</div>
	{{#if lead}}<p class="{{lead.cssClass}}" id="{{id}}-lead">{{lead.text}}</p>{{/if}}
	<p class="confirm-popover__body" id="{{id}}-body">{{body}}</p>
	{{{actionsHtml}}}
</div>`;
