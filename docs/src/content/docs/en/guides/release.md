---
title: Releasing a new version
description: One command updates eight manifests, runs the gates, commits, tags, and pushes to the remote; after the tag is pushed, GitHub Actions handles packaging, publishing, and creating the Release.
---

The entry point for a release is one command. It computes the version number, updates the eight manifests to the same number, runs the gates, commits, creates an annotated tag, and pushes the branch and tag together.

```bash
pnpm release --bump patch
```

After the push, the tag triggers the release workflow: it re-checks the gates, self-checks the packaging, publishes to the registry using OIDC to obtain credentials, and generates the Release from the commit history. **This local step does not publish to npm** — publishing once in each place would make the registry contents disagree with the tag.

## How the version number is chosen

Three bump levels, or an exact version with `--version`:

```bash
pnpm release --bump patch          # 0.1.5 → 0.1.6
pnpm release --bump minor          # 0.1.5 → 0.2.0
pnpm release --bump major          # 0.1.5 → 1.0.0
pnpm release --version 0.2.0-rc.1  # specified directly, including a prerelease suffix
```

When the current version carries a prerelease suffix, all three bumps only clear the suffix and do not advance another level: the patch of `0.2.0-rc.1` is `0.2.0` itself — a prerelease is a preview of a formal version, and formalizing it should not take another step.

Prerelease suffixes only accept the three-part form: `0.2.0-rc.1` is valid, `0.2.0.rc.1` is not (semantic versioning's major/minor/patch are three numeric positions). Versions with `+build metadata` are rejected — npm publishing silently truncates everything after `+`, so the number on the registry, the tag, and the number in the manifests would immediately disagree.

## The difference between the two tag names

Formal versions publish `latest`; prerelease versions publish the first segment of their suffix:

| Version         | dist-tag | How to install it             |
| --------------- | -------- | ----------------------------- |
| `1.2.3`         | `latest` | `npm install <package>`       |
| `1.2.3-rc.1`    | `rc`     | `npm install <package>@rc`    |
| `1.2.3-alpha.1` | `alpha`  | `npm install <package>@alpha` |

Using the first suffix segment rather than a uniform `next` keeps previews like rc and alpha from overwriting each other on the registry.

## Cases the command blocks

Before acting, the release script checks a few things and stops if any is unsatisfied:

- **Not currently on `main`**: the tag would point at a commit on main; tagging on another branch makes the release page point at the wrong place.
- **Dirty working tree**: the commit after updating the manifests would carry uncommitted changes along, mixing them into a release commit.
- **Invalid version number**: see the previous section.
- **Tag already exists** (local or remote): one version cannot correspond to two commits; use a different number.

The gates run before the commit: if type checking, code style, unit tests, or the runtime reachability-graph check fails any one, nothing is committed and no tag is created. The tag must point at a commit that passes on its own — if you committed first and checked after, a failure would require a follow-up patch commit, and the tag might already have been pushed.

## Preview only, without landing

```bash
pnpm release --bump patch --dry-run   # prints the number of manifests to change; writes no files, runs no gates
pnpm release --bump patch --no-push   # goes as far as the local commit and tag
```

`--dry-run` does not check whether the working tree is clean: the preview itself changes no files, and a dirty working tree should not block taking a look.

The typical use of `--no-push` is to prepare the commit and tag first, then push manually when the network or timing is right:

```bash
git push origin main && git push origin v0.1.6
```

## After publishing

Within a few minutes of pushing the tag you can verify these:

```bash
npm view <package>@<version> version          # this version exists on the registry
npm view <package> dist-tags              # latest or rc / alpha points at it
```

The Release page is created automatically by the workflow; its body is taken from the "Added / Improved / Fixed / Other changes" sections of that span of the commit history. So **writing commit messages in the sectioned format** is the prerequisite for release-note quality; a one-line commit leaves only that one line in the notes.

Publishing is idempotent: the workflow asks the registry per package "does this version exist?" and skips it if so. If some package fails midway, re-running as-is does not fail wholesale because "the version already exists".
