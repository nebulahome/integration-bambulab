# NebulaHome integration template

The repository a NebulaHome integration starts from. An **integration** teaches the platform a
brand of devices: how they are found, what adding one asks, what each device is and what it
exposes, and how its state and commands travel. It is a **vendor directory** the hub loads, built
and checked with [`@nebulahome/integration-sdk`](https://www.npmjs.com/package/@nebulahome/integration-sdk).

This template is a vendor that works: _Example_ lamps on the house's network, found over mDNS,
read and switched over their HTTP API by a declarative profile - no code. `examples/` adds a
transport and a discovery module of the vendor's own, for a protocol the platform does not speak.
Keep what you need, change what it says, delete the rest.

## Start

1. **Use this template** on GitHub; name the repository `integration-<vendor>` - the Community Hub
   imports a vendor only from a repository named so - and make it public.
2. In `src/manifest.json`, set the `id` (the vendor, `<vendor>`), `name`, `description`, `url` and
   `color`; in `package.json`, the `name` (`integration-<vendor>`), the `version` and the
   `repository`.
3. Replace `src/logo.svg`; rename `src/lamp/` to your first driver and rewrite its three files.
4. `pnpm install`, and commit `pnpm-lock.yaml`: the release workflow installs from it.

```bash
pnpm nebulahome-integration validate   # src/ holds together, the way the hub reads a bundle
pnpm typecheck
pnpm test                              # the vendor loaded and driven as the hub does
pnpm nebulahome-integration build      # dist/<vendor>/: what the hub loads
pnpm nebulahome-integration pack       # <vendor>-<version>.tgz: what a release carries
```

## What is where

| File | What it is |
| --- | --- |
| `src/manifest.json` | Who the vendor is. `version` and `sdk` are not written here: the build takes the version from `package.json` and the runtime range from the SDK. |
| `src/logo.svg` | The mark the interface shows, an SVG or a PNG of at most 64 KiB. |
| `src/discovery.json` | How lamps are found without being told where: the mDNS service they announce, what of the announcement says it is one of them, and who it says it is. The model code names the driver, through `modelCodes`. |
| `src/lamp/driver.json` | The driver: the models it drives and their codes, the transport it speaks (`http`), its profile and its setup. |
| `src/lamp/setup.json` | What adding a lamp asks - its address - and how often it is read. |
| `src/lamp/profile.json` | What a lamp means: how its probe answer is claimed and identified, what is polled, its light entity's state and commands. |
| `tests/example.test.ts` | The vendor under `loadIntegration`, `driverHarness` and `identify`. |
| `examples/` | A UDP transport and a discovery module of the vendor's own, with their tests ([examples/README.md](examples/README.md)). |
| `.github/workflows/release.yml` | On a `v<version>` tag: validate, typecheck, test, build, pack, and a GitHub release with the archive. |

Every JSON file names its schema (`$schema`), so the editor checks and completes it once
`pnpm install` has run; the build drops it.

## Trying it on a platform

- **From the platform's local folder**: `pnpm nebulahome-integration build`, then `pack`; copy
  `<vendor>-<version>.tgz` into the platform's `infra/local-integrations/`, and install it from
  **Integrations → Install**, where it shows as a _Local file_. After another build of the same
  version, the vendor's page offers **Reinstall**. Nothing restarts.
- **As a bundle under development**: add this repository's `dist/` to the platform's
  `HUB_DEV_BUNDLE_DIR` (directories separated by `;` on Windows, `:` on Linux) and restart the hub
  after each build.

## Releasing

Raise `version` in `package.json`, commit, and push the tag `v<version>`. The workflow publishes
a GitHub release with `<vendor>-<version>.tgz` - the only archive it may carry - and the Community
Hub imports it: from then on the vendor is offered in the **Install** dialog of every installation
whose platform runs the contract it was built for. A vendor with code of its own asks the owner to
trust its publisher before it installs, until the Community Hub marks it official.
