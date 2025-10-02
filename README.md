# Gemini CLI - Custom Fork

This is a custom fork of [@google/gemini-cli](https://github.com/google-gemini/gemini-cli) with additional features and customizations.

## Custom Features

- **Custom keybinds** with clipboard support
- **Detailed logging** for better debugging
- **Custom system prompts** tailored to specific workflows
- **Automatic updates** from GitHub releases

## Installation

### Quick Install (Recommended)

Download and install the latest version directly:

```bash
curl -L -o ~/.local/bin/gemini https://github.com/ismellpillows/gemini-cli/releases/latest/download/gemini.js
chmod +x ~/.local/bin/gemini
```

Make sure `~/.local/bin` is in your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### From Source

```bash
git clone https://github.com/ismellpillows/gemini-cli.git
cd gemini-cli
npm install
npm run bundle
# Copy bundle/gemini.js to your preferred location
```

## Updates

The CLI automatically checks for updates and will download the latest version from GitHub releases.

To manually update:

```bash
curl -L -o ~/.local/bin/gemini https://github.com/ismellpillows/gemini-cli/releases/latest/download/gemini.js
chmod +x ~/.local/bin/gemini
```

## Upstream Sync

This fork automatically rebases custom commits onto new stable releases from the upstream repository [@google/gemini-cli](https://github.com/google-gemini/gemini-cli).

The sync process:
1. Runs weekly (every Monday at 2 AM UTC)
2. Checks npm for new stable releases
3. Automatically rebases custom commits onto the new version
4. Creates a GitHub release with the built bundle
5. If conflicts occur, creates a PR for manual resolution

## Development

All standard commands from the upstream repository work:

```bash
npm install
npm run build
npm run test
npm run bundle
```

## Differences from Upstream

- Disabled scheduled workflows (issue triage, PR automation, etc.)
- Added custom auto-update workflow for fork maintenance
- Modified update checker to use GitHub releases instead of npm
- Custom commits are automatically preserved during upstream syncs

## Upstream Repository

Original project: https://github.com/google-gemini/gemini-cli

## License

Apache License 2.0 - Same as upstream
