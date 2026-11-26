export const NOT_FOUND_TEMPLATE = `<main class="not-found">
	<div class="not-found__container">
		<h1 class="not-found__title">{{t "notFound.title"}}</h1>
		<p class="not-found__text">{{t "notFound.text"}}</p>
		<a href="{{track '/' source=trackSource content='home'}}" class="btn btn--primary not-found__action">{{t "notFound.action"}}</a>
	</div>
</main>`;
