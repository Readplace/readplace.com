export const ACCOUNT_LOCKED_TEMPLATE = `<main class="account-locked">
  <div class="account-locked__card">
    <h1 class="account-locked__title">{{t "accountLocked.title"}}</h1>
    <p class="account-locked__lede">{{t "accountLocked.lede.before"}} <a class="account-locked__link" href="mailto:{{contactEmail}}">{{contactEmail}}</a> {{t "accountLocked.lede.after"}}</p>
    <form method="POST" action="{{track '/logout' source=logoutTrackSource content='logout'}}">
      <button class="btn btn--primary account-locked__signout" type="submit">{{t "accountLocked.signOut"}}</button>
    </form>
  </div>
</main>`;
