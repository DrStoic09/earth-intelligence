# Handling FIRMS_MAP_KEY

- GitHub Actions: repo Settings > Secrets and variables > Actions > `FIRMS_MAP_KEY`
  (already set). The workflow maps it to an env var for one step only.
- Local development: copy `.env.example` to `.env` (gitignored) and export it yourself.
- Never use a `NEXT_PUBLIC_` prefix: that would ship the key to every browser.

## If a deployed backend ever needs the key
The planned design is static: Actions fetches FIRMS and publishes JSON, so the
hosting provider needs no key. If you later add a server-side function, store it as
an encrypted secret named `FIRMS_MAP_KEY` there:
- Cloudflare Workers/Pages: dashboard > Settings > Variables and Secrets (type Secret),
  or `npx wrangler secret put FIRMS_MAP_KEY`.
- Render: service > Environment > add `FIRMS_MAP_KEY`.
- Vercel: Project Settings > Environment Variables (mark Sensitive).
Read it server-side only, and never return it in a response.

## If the key is ever exposed
Request a new MAP_KEY from FIRMS, update the GitHub secret, and treat the old one as burned.
