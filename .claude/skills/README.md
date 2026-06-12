# Skills

This directory vendors the **Superpowers** skills library by Jesse Vincent (obra).

- Upstream: https://github.com/obra/superpowers
- Version: 5.1.0
- License: MIT (see `SUPERPOWERS-LICENSE`)

## Why vendored instead of installed as a plugin

The upstream install path (`/plugin marketplace add obra/superpowers-marketplace`)
writes into `~/.claude/plugins/`, which is **ephemeral** in cloud / Claude Code on
the web environments — it is wiped when the container is reclaimed. Committing the
skills into the repo's `.claude/skills/` makes them reload automatically at the
start of every session, with no per-session install step.

## How it works

- Each subdirectory is one skill with a `SKILL.md` (plus any helper files).
  Claude Code discovers them automatically and they are invoked with the `Skill` tool.
- `.claude/hooks/superpowers-session-start.sh` (registered in `.claude/settings.json`)
  injects the `using-superpowers` entry skill at session start, mirroring the
  upstream SessionStart hook. This is what prompts the agent to reach for a skill
  before acting.

## Updating

```bash
git clone --depth 1 https://github.com/obra/superpowers.git /tmp/superpowers
cp -R /tmp/superpowers/skills/. .claude/skills/
cp /tmp/superpowers/LICENSE .claude/skills/SUPERPOWERS-LICENSE
```
