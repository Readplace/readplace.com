/** Global so any page's toast auto-dismisses — including one that arrives
 * inside an htmx-swapped <main>, which a page-scoped script would never see. */
export const TOAST_SCRIPT = `<script src="/client-dist/toast.client.js" defer></script>`;
