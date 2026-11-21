# KitsuFlowBOT Assistant (desktopapp branch)

This branch holds only the KitsuFlowBOT Assistant desktop app and its Windows x64 / Linux AMD64 packaging. The KitsuFlowBOT server and Studio stay on `main`.

The Assistant is one app for the stream features that run on your PC: voice-triggered clips, Beat Saber song requests (`!bsr`) and Minecraft Interactive over RCON. It replaces the old single-purpose Voice Companion, and existing device keys keep working.

Download builds from [GitHub Releases](https://github.com/NekoSuneProjects/KitsuFlowBOT/releases) or [GitHub Actions](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/assistant-build.yml?query=branch%3Adesktopapp). Downloaded builds need no Python install.

See the [quick start](assistant/QUICKSTART.md) and the [app README](assistant/README.md).

## Versioned GitHub Releases

Each new `desktopapp-vMAJOR.MINOR.PATCH` Git tag triggers the desktop build workflow for both platforms and publishes a GitHub Release with:

- `KitsuFlowBOTAssistant-desktopapp-v1.0.0-windows-x64.zip` (Windows executable, docs and .env template)
- `KitsuFlowBOTAssistant-desktopapp-v1.0.0-linux-amd64.zip` (Linux executable, docs and .env template)
- `SHA256SUMS.txt` for ZIP checksums

Replace `1.0.0` with the chosen release version. Example, after updating `desktopapp`:

```bash
git checkout desktopapp
git pull origin desktopapp
git tag desktopapp-v1.0.0
git push origin desktopapp-v1.0.0
```

The workflow only publishes a release after **both** platform builds succeed and verifies that the tag targets a commit on `desktopapp`. Normal commits continue to build Actions artifacts without flooding the Releases page. Versioned assets appear at [GitHub Releases](https://github.com/NekoSuneProjects/KitsuFlowBOT/releases). Pre-release suffixes such as `desktopapp-v1.1.0-beta.1` are supported.

Release publishing requires Actions to have permission to create releases with `GITHUB_TOKEN`. The workflow requests `contents: write` specifically for the publishing job. If repository policy blocks tag-triggered workflows or release writes, update repository Actions permissions.
