# Putting the app on Cloudflare

The app is static files, served by Cloudflare Workers static assets, plus a small Worker script
([`worker/`](../worker/)) that runs only for `/coach` and `/api/coach`: the AI coach and the idea
box. [`wrangler.jsonc`](../wrangler.jsonc) names the Worker `chess`, serves the repo folder and
binds the Worker's storage; [`.assetsignore`](../.assetsignore) leaves out the tests, tools,
docs and Worker source. There's no build step.

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

## Turning on the AI coach

The app works without these steps: the coach then writes its free notes on the device. Each
step is in a dashboard; no key or ID goes in the repo or in chat.

1. **Anthropic.** In the Claude Console, create a workspace used only for this app, set its
   monthly spend limit to $10, and create an API key in it. Paste the key straight into the
   Cloudflare dashboard: the `chess` Worker, **Settings**, **Variables and Secrets**, **Add**,
   type **Secret**, name `ANTHROPIC_API_KEY`. Keep the master copy in the password manager. To
   rotate, add the new key first, then revoke the old one.
2. **Salt.** On the same page add a secret named `USER_SALT`: a long random string from the
   password manager. It scrambles the key the daily counters are kept under.
3. **Sign-in (Cloudflare Access).** In Zero Trust, **Access**, **Applications**, add a
   self-hosted application for `chess.prignano.ai` with two paths, `coach` and `api/coach`.
   Login methods: Google (the same one the family app uses) and One-time PIN, for a child
   whose Google account can't sign in to other sites. Add one Allow policy that includes only the
   family's emails. Then copy two values into the Worker as plain variables (type **Text**):
   the application's **Audience (AUD) tag** as `ACCESS_AUD`, and the team domain
   (`<team>.cloudflareaccess.com`) as `ACCESS_TEAM_DOMAIN`.
4. **Check it.** Open the app, Menu, Your level: it should say "Not signed in" with a Sign in
   link. Sign in, come back, and it shows today's reviews left. Finish a game and choose
   Review this game: the review says "Written by the AI coach".

The Worker checks the Access token itself as well, so a request that skips Access (for example
on the `workers.dev` address) never reaches Claude.

## Reading the idea box

Ideas sent from the app are stored in the Worker's `IDEAS` KV namespace (Wrangler creates it on
the first deploy with this config) for a year, without the sender's name or email. Read them in
the dashboard under **Storage & Databases**, **KV**, or ask a Claude thread with the Cloudflare
connector to read them and turn them into issues. They are never sent to the AI.

## After that

Every merge to `main` deploys on its own. Other branches get preview builds if
**Settings**, **Builds** has non-production branch builds turned on. To roll back, open the
Worker's **Deployments** tab and pick an earlier version.

## Checking it

- `https://chess.prignano.ai/` shows the board in the site theme with the site header.
- `https://chess.prignano.ai/test/` and `/tools/` return 404 (left out by `.assetsignore`).
- The browser console shows no errors.
- `https://chess.prignano.ai/api/coach/status` without signing in sends you to the sign-in page.
