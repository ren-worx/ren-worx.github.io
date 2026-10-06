# renworx - Fastly test site

Static site for testing Fastly caching, delivery and security behavior.

## Run locally (Visual Studio)
- Open the `renworx` folder (File > Open > Folder) and use Live Server / Live Preview, or run `python -m http.server 8080` in the folder and visit http://localhost:8080.
- Locally there are no Fastly headers. Point your Fastly service at the GitHub Pages origin and open the site through your Fastly domain to see X-Cache, Age, X-Served-By etc.

## Publish to GitHub Pages
1. Push this folder's contents to a repo (index.html at the repo root).
2. Settings > Pages > Deploy from branch > main / root.
3. Origin host for Fastly: `<username>.github.io` (set Host header override to the same, TLS SNI on). If it's a project site, requests use `/<repo>/...`; the page's relative links work either way, but 404.html uses absolute `/styles.css`, so change it to `styles.css` if you use a project site.

## Login path for ATO / credential stuffing tests
The site posts to `/login` (relative to wherever it's hosted). GitHub Pages can't process that POST — it's a static host — so a 404/405 there is expected unless Fastly or a Compute service intercepts the path. That's fine: the point is to give your WAF / rate-limit / bot-protection rules a real request to match against (path `login`, method POST), not to simulate a working auth backend.

## Note
GitHub Pages is static: no custom response headers, no POST handling. Add cache, security and geo headers in Fastly (VCL or the UI), then use the Security header audit and Edge headers tests to verify them.
