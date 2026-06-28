# Contributing

Thanks for your interest in improving Custom Yoto Cards! Contributions — bug reports,
docs fixes, new icon sets, or features for `yoto-upload.js` — are all welcome.

## Ground rules

- **Open an issue first** for anything substantial, so we can agree on the approach
  before you spend time on a PR.
- **Never commit secrets or copyrighted audio.** `.yoto-token.json`, `.env`, and
  `*.mp3` are git-ignored for a reason — keep it that way. Bring your own audio.
- Keep `yoto-upload.js` **dependency-free** (Node 18+ built-ins only). If you think a
  dependency is truly necessary, raise it in an issue first.

## Workflow

1. Fork the repo.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. Make your change. For script changes, run `node --check yoto-upload.js` and do a
   real test run against your own Yoto account.
4. If you change the flow, update **both** `README.md` and `CLAUDE.md` so the docs
   stay in sync.
5. Commit (`git commit -m "feat: describe your change"`) and open a pull request
   describing what you changed and how you tested it.

## Reporting bugs

Include: what you ran, what you expected, what happened (with any error output), your
Node version, and OS. Redact any tokens or client secrets from logs.
