# BuildReady

BuildReady is a small, deterministic readiness checker for Node.js projects. It inspects a project directory, reports one result for each supported buildathon requirement, and returns an overall pass/fail result. The checker is exposed as `checkProject(path)` from `src/checker.js`; the command-line wrapper is `src/cli.js`.

## Purpose

Use BuildReady before submitting or handing off a project to catch missing repository and delivery artifacts early. It does not build the application, install dependencies, contact a service, or execute project code. A check result has this shape:

```js
{
  projectPath,
  checks: [{ id, label, passed, details }],
  passedCount,
  totalCount,
  passed
}
```

## Usage

Install the locked dependency set and run the test suite:

```sh
npm ci
npm test
```

The package also exposes these project-root commands:

```sh
npm start
npm run check
```

Check the current directory:

```sh
node src/cli.js .
```

Emit the same result as machine-readable JSON. The path may be absolute or relative, and `--json` may be supplied with it:

```sh
node src/cli.js . --json
node src/cli.js /path/to/project --json
```

A successful project exits with status `0`. A project with one or more failed checks exits non-zero. Human-readable output is intended for terminal use; `--json` writes the result object without presentation formatting so CI or a buildathon script can parse it.

## Supported checks

BuildReady currently returns eight checks. Their stable IDs and behavior are:

- **`git-repository`** — a `.git` directory or worktree file identifies the project as version controlled.
- **`dependency-lockfile`** — a non-empty lockfile is present. Common npm, Yarn, pnpm, Bun, Cargo, Python, Ruby, Go, Composer, and other ecosystem lockfile names are recognized.
- **`pinned-runtime`** — an exact runtime version is declared in `.nvmrc`, `.node-version`, `runtime.txt`, `.tool-versions`, `mise.toml`, `package.json` `engines`, or a versioned Docker `FROM` image.
- **`dockerfile`** — `Dockerfile` exists at the project root.
- **`test-command`** — a non-placeholder test command is configured in `package.json` `scripts.test` or a `test` recipe exists in a Makefile.
- **`readme`** — a README file exists at the project root.
- **`env-example`** — `.env.example` exists at the project root.
- **`absolute-paths`** — text files do not contain common machine-specific absolute paths. The scan skips `.git`, `node_modules`, binary files, and files larger than 1 MiB; URLs are not treated as local absolute paths.

Each result in `checks` has `{ id, label, passed, details }`. Use `id` for stable programmatic handling, `label` for display, and `details` for the reason a check passed or failed. `package.json` is inspected for the test command and optional runtime pin, but it is not itself a separate required-file check.

## Docker

Build the image from the project root:

```sh
docker build -t buildready .
```

Check a mounted project in normal terminal output:

```sh
docker run --rm -v "$PWD:/workspace:ro" buildready node src/cli.js /workspace
```

Check the same mounted project as JSON:

```sh
docker run --rm -v "$PWD:/workspace:ro" buildready node src/cli.js /workspace --json
```

The read-only mount lets the checker inspect a project without allowing the container to change it.

## Offline testing

The tests use only Node's built-in `node:test` and `node:assert/strict`; they do not need a network service. When dependencies are already installed, run the suite without npm accessing the registry:

```sh
node --test test/checker.test.js
npm test
```

For a clean offline install, use the lockfile and a populated local npm cache:

```sh
npm ci --offline
npm test
```

If `npm ci --offline` reports a missing cached package, keep the existing `node_modules` directory or populate the npm cache on a connected machine first; the test itself remains offline once Node and the project files are present.

## Project structure

```text
.
├── src/
│   ├── checker.js       # checkProject(path) implementation
│   └── cli.js           # command-line interface and --json output
├── test/
│   └── checker.test.js  # contract and CLI tests
├── fixtures/
│   ├── passing-project/ # complete, self-contained project fixture
│   └── missing-required/ # intentionally incomplete fixture
├── .gitignore
├── Dockerfile
├── .env.example
├── .nvmrc
├── package.json
├── package-lock.json
└── README.md
```

The fixtures are intentionally small. `passing-project/.git/HEAD` is a marker file rather than a full Git history, which keeps the fixture deterministic and self-contained.

## Buildathon-compliance notes

- Keep a non-empty lockfile committed and use `npm ci` for reproducible dependency installation when the project uses npm.
- Keep an exact runtime pin aligned with the runtime used by CI and the Docker image.
- Include a working README, Dockerfile, and test command so a reviewer can build and verify the project quickly.
- Commit `.env.example` with variable names and safe example values; never commit real credentials or tokens.
- Run `node src/cli.js . --json` in automation and fail the job when the process exits non-zero.
- Keep the repository marker and source changes under version control so the submission can be reproduced from a clean checkout.
