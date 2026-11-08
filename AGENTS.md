# Instructions for AI assistants

A browser chess app with a coach: plain JavaScript, no build step, plus one Cloudflare Worker.
The plan is in [docs/SPEC.md](docs/SPEC.md); read it first.

- The app is GPL-3.0-or-later because it ships Stockfish. Keep the About screen's notices, the
  link to the exact Stockfish source, and the notices of every MIT or BSD dependency.
- The Claude API key lives only in a Cloudflare Worker secret. Never in the repo, a claude.ai
  environment, tests or chat. Tests never call the real Claude API, chess.com or Cloudflare.
- Keep the spend controls in the spec true (workspace limit, reserved budget, per-user limits,
  fail closed). A change that weakens them, the allowlist, or the structured-only coach input
  needs the owner's explicit yes.
- Kids may play: no analytics, no free-text input to Claude, no personal data beyond what the
  spec lists.
- No chess.com art, palettes, sounds or move-classification glyphs. Pieces, board and sounds
  are our own.
- Never put API keys, account or tenant IDs, domains other than the app's own, IPs, emails,
  secrets, or employer, customer or private-project names in the repo, commits, issues or PR
  text.
- Never ask for, show or store a secret in chat. The owner runs the step that handles it.
- Propose changes as pull requests. Never change a real account, deployment or spend setting
  without the owner's explicit yes.

## How to make a change

Four rules after the community "Karpathy guidelines" (MIT), reworded for agents that work unattended.

- Say what you assumed. When the ask leaves a detail open, pick the reasonable default, say which,
  and keep going. Stop to ask only when the choice changes the goal, something the owner will
  notice, or a step no one can undo; if no one is there to answer, do the reversible part and leave
  the question in the PR body. If a simpler way exists than the one asked for, say so.
- Write the least code that does the job: no features, options or abstractions nobody asked for,
  and no handling for cases that can't happen.
- Touch only what the task needs and match the style around it. Every changed line should trace
  back to the ask. Mention unrelated dead code instead of deleting it; remove only what your own
  change left unused.
- Before you start, name the check that proves the task is done (a failing test, the "Checks to
  run" below, an expected output), and don't call it done until it passes in front of you.

## Checks to run

```bash
node --test
```
