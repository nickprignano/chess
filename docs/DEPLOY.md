# Putting the app on Cloudflare

The app is static files, served by Cloudflare Workers static assets with no Worker script.
[`wrangler.jsonc`](../wrangler.jsonc) names the Worker `chess` and serves the repo folder;
[`.assetsignore`](../.assetsignore) leaves out the tests, tools and docs. There's no build step.

The owner does these steps in the Cloudflare dashboard. Nothing here needs a key or token in the
repo: Cloudflare's GitHub app deploys on each push to `main`.

## One-time setup

1. In the Cloudflare dashboard, open **Workers & Pages**, choose **Create application**, then
   **GitHub**.
2. Sign in to GitHub if asked, and pick `nickprignano/chess`.
3. Settings:
   - **Project name**: `chess`. It must match `name` in `wrangler.jsonc`, or the build fails.
   - **Production branch**: `main`.
   - **Build command**: leave empty.
   - **Deploy command**: `npx wrangler deploy` (the default).
   - **Root directory**: `/` (the default).
4. Choose **Save and Deploy**. When it finishes, the app is on the `chess` `workers.dev` address the
   dashboard shows. Open it and play a few moves to check.
5. Add the domain: open the `chess` Worker, then its **Domains** tab (older dashboards:
   **Settings**, **Domains & Routes**), **Add**, **Custom domain**, and enter `chess.prignano.ai`. Cloudflare adds the DNS record and
   certificate itself, because the domain's zone is already on the account.
6. Optional: on the same tab, turn off the `workers.dev` address so the
   app has one home.

## After that

Every merge to `main` deploys on its own. Other branches get preview builds if
**Settings**, **Builds** has non-production branch builds turned on. To roll back, open the
Worker's **Deployments** tab and pick an earlier version.

## Checking it

- `https://chess.prignano.ai/` shows the board in the site theme with the site header.
- `https://chess.prignano.ai/test/` and `/tools/` return 404 (left out by `.assetsignore`).
- The browser console shows no errors.
