/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Where this copy is served from, ending with `/`. Set with PUBLIC_URL at build time (vite.config.ts). */
declare const __PUBLIC_URL__: string;
/** The development address Todoist also returns to, listed in oauth/client.json. */
declare const __OAUTH_DEV_REDIRECT__: string;
