# Uploading a build

The build is a static site: `npm run build` puts it in `dist/`, and any host
that serves files will do. What follows is the part that is easy to get wrong.

Upload the **whole** of `dist/`, `assets/` and the dotfile included. Every
other file sits at the root, which is deliberate: the icons used to live in
`dist/icons/`, that folder was dropped by an upload twice, and the second
failure left a directory on the server that could not be read into or
repaired by re-uploading. A manifest whose icons all 404 fails the browser's
installability check silently — the app looks and works perfectly, it simply
stops offering to install and the installed copy has no icon of its own.

Two things to check after an upload:

```bash
curl -o /dev/null -w '%{http_code}\n' https://<host>/icon-192.png   # 200
curl -o /dev/null -w '%{content_type}\n' https://<host>/manifest.webmanifest
curl -s https://<host>/oauth/client.json | head -c 40                     # {"client_id"…
curl -sI https://<host>/ | grep -i content-security-policy
```

The second should say `application/manifest+json`. It comes from `.htaccess`,
which ships in `dist/` — a dotfile, so a client set to hide them will skip it.

The third is what "Continue with Todoist" depends on: Todoist fetches that
file to identify the app. The build writes it for `PUBLIC_URL`, the official
site by default; a copy hosted anywhere else must be built with
`PUBLIC_URL=https://<host>/ npm run build` (see "Self-hosting" in the README),
and the file's `client_id` should then start with that address. If it answers with the app's own page instead, the
`oauth/` folder was not uploaded and Todoist replies `invalid_client`. The
fourth checks that `.htaccess` is in place; without it the app still works,
without its Content-Security-Policy.
