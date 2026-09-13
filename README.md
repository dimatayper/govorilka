<p align="center">
  <img src="./fluxer_static/marketing/branding/govorilka-logo.svg" alt="Govorilka" width="440">
</p>

<p align="center">
  An open platform for messaging, voice, and video calls—built for friends, teams, and communities.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-7b2cbf" alt="AGPL-3.0-or-later license"></a>
</p>

> [!NOTE]
> Govorilka is an independent fork of [Fluxer](https://github.com/fluxerapp/fluxer). The Fluxer name and its visual assets are the property of their respective owner and are not used to identify this fork.

## Features

- Direct and group messaging
- Spaces for communities and teams
- Voice and video calls
- Web app, administration panel, and desktop client
- Self-hosting with Docker Compose
- Open-source code licensed under AGPL-3.0-or-later

## Quick start

The easiest reproducible way to run Govorilka locally is with a Dev Container.

### Requirements

- Git
- Docker
- An editor with [Dev Containers](https://containers.dev/) support
- At least 4 CPU cores, 8 GB of RAM, and 32 GB of free storage are recommended for the full environment

### Run locally

```sh
git clone https://github.com/dimatayper/govorilka.git
cd govorilka
# Open the repository in a Dev Container, then run:
pnpm dev
```

The container installs dependencies and prepares the infrastructure on first launch. The application will be available at <http://localhost:8088>.

## Development

The Dev Container provides compatible versions of Node.js, pnpm, Rust, Erlang, and the required system libraries.

1. Open the repository in an editor that supports Dev Containers.
2. Select **Reopen in Container**. Bootstrap and dependency installation run automatically.
3. Start the application:

```sh
pnpm dev
```

The development proxy listens on <http://localhost:8088>. Put local environment overrides in `config/env/local.env`; the file is excluded from Git.

Common commands:

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the complete development stack |
| `pnpm dev:infra:start` | Start infrastructure services |
| `pnpm dev:infra:status` | Show infrastructure status |
| `pnpm dev:infra:stop` | Stop infrastructure services |
| `pnpm build` | Build the web and desktop applications |
| `pnpm test` | Run workspace tests |
| `pnpm lint` | Check formatting and lint rules |
| `pnpm typecheck` | Run type checks |

Before submitting a change, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

## Repository structure

| Path | Purpose |
| --- | --- |
| `fluxer_app` | Web client |
| `fluxer_desktop` | Desktop client |
| `fluxer_admin` | Administration panel |
| `fluxer_api` | API and background jobs |
| `fluxer_gateway` | Real-time event gateway |
| `fluxer_*` | Supporting Rust and Erlang services |
| `packages` | Shared TypeScript, UI, localization, and schema packages |
| `deploy/self-hosting` | Self-hosting configuration |
| `tools/dev` | Unified CLI for builds, checks, and local development |

The repository is a monorepo. pnpm workspaces manage the JavaScript and TypeScript packages, while Cargo workspaces manage the Rust components.

## Self-hosting

Deployment templates live in [`deploy/self-hosting`](./deploy/self-hosting). Before exposing an instance publicly:

1. Copy `.env.example` to `.env`.
2. Configure the public domain and scheme.
3. Replace every `CHANGE_ME` value with a unique, cryptographically secure secret.
4. Choose an ingress mode: built-in HTTPS, an external reverse proxy, or a tunnel.
5. Start the stack and verify that all containers are healthy.

To build the complete self-hosted stack from the current source tree, follow the [local deployment guide](./deploy/self-hosting/LOCAL.md). Do not use that configuration in production: some safeguards are intentionally relaxed for development.

## Contributing

Before contributing, read the [contribution guidelines](./.github/CONTRIBUTING.md), [Code of Conduct](./.github/CODE_OF_CONDUCT.md), and pull request template. Keep each change focused and add tests for changed behavior.

Found a vulnerability? Do not disclose it in an issue or discussion. Use the private reporting channel described in the [security policy](./.github/SECURITY.md).

## License

The source code is available under the [GNU Affero General Public License v3.0 or later](./LICENSE). If you make a modified version available over a network, you must comply with the AGPL source-availability requirements.

Some fonts, images, and other assets have separate terms. Refer to the `NOTICE` and `LICENSE` files stored alongside those assets.
