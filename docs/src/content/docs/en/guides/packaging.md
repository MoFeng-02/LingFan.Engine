---
title: Packaging & encrypted release
description: Turn a plaintext project into an encrypted package players can install — first build the frontend shell encrypted, then collect resources and artifacts with lfenpack, then place the whole package into the shell's resource directory.
---

During development the project is plaintext: the files under `Resources/` open directly, and `resourceEncryption` in `project.json` is `false` or absent. The package in a player's hands cannot be like that — resources must be ciphertext, the frontend artifacts must be ciphertext, and only the entry `index.html` stays plaintext for the shell to load.

This is not one command; it is three steps. They are described in order below, and each step's output must be checked.

## 1. Build the frontend shell encrypted

```bash
LFEN_ENCRYPTED_BUILD=1 pnpm tauri build
```

This environment variable is the only switch; without it you get an ordinary build. It takes effect in the finishing script that runs after `pnpm build`, doing four things:

- Rewrite the `./assets/…` references in `dist/index.html` to addresses that go through the in-shell protocol (`{protocol base}/v2/dist%2Fassets%2F…`). The protocol base is inferred from the host platform: `darwin` and `linux` use `lfstream://localhost`, everything else uses `http://lfstream.localhost`; you can also set it explicitly with `LFEN_PROTOCOL_BASE` (an iOS build needs this).
- Move `dist/assets` wholesale into `dist-enc/assets/`, **keeping the `assets/` layer**. The logical path prefix of these artifacts in the package is `dist/assets/…`, which must correspond verbatim to the URLs just rewritten; drop a layer and you get a 404 at runtime.
- Clear everything in `dist` except `index.html` and `splashscreen.html`. The reason is that vite's `publicDir` points at `Resources`, so the build mirrors the plaintext resources into `dist` — leave them there and they get embedded in the shell, which means no encryption.
- Finally scan `dist`; if any `.js` / `.mjs` / `.css` remains, fail and exit immediately, so a "looks successful" encrypted build is never produced.

After the build, `dist` holds only the two html files, and `dist-enc/` holds the artifacts awaiting encryption. `dist-enc` is not for the shell; it is the input to the next step.

## 2. Collect resources and artifacts with lfenpack

First build the tool (it is used only on the packaging machine and is not distributed with the player package):

```bash
cd apps/playground/src-tauri
cargo build --bin lfenpack --release
```

Then run it once against the project's resource root:

```bash
lfenpack <project resource root> <output dir> --dist apps/playground/dist-enc --strict
```

The first argument is the directory containing `project.json`; the second is the output root, created if it does not exist. If it already exists and is non-empty you must add `--force` to overwrite (it deletes the output directory entirely first, so the path must not equal or nest with the input — there is a pre-check for this).

`--dist` collects the frontend artifacts into the package too, using `dist/` as the logical path prefix. html is not on the collection whitelist — the entry html is meant to be embedded plaintext in the shell, so its appearance in the `--dist` input means some upstream step went wrong; it lands in the report's "not packed" rather than being quietly encrypted.

### What goes in the package and what does not

| Category                      | Handling                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Story, translations, manifest | Encrypted                                                                                  |
| Images, audio, video          | Encrypted                                                                                  |
| Fonts                         | Encrypted                                                                                  |
| `js` / `css`                  | Encrypted (via v2 storage, decrypted on demand at runtime)                                 |
| `project.json`                | **Plaintext** — project metadata must be readable                                          |
| `Saves/`                      | Excluded — runtime-generated content does not go in the package                            |
| Files off the whitelist       | Not packed; the report gives a reason per item, **never silently carried in as plaintext** |

### Output

- One ciphertext per content file, named as the original logical path plus `.enc`.
- One key seed file (`__key__.seed`), **distributed plaintext with the package** — it is the resource DEK. On first run the platform layer imports it and wraps it with its own KEK into a runtime cache, but the seed itself remains in the package (casual-level semantics; see "Current state and limits").
- The manifest lands as-is, but `resourceEncryption` is changed to `true`; when frontend artifacts are collected there is also a `frontend.assets` mapping section.

When it finishes it prints four lists: **encrypted** / **plaintext (with reason)** / **excluded** / **not packed**. The "plaintext (with reason)" in the first two lists contains only `project.json` and the key seed — those are the two that must be plaintext by design, not omissions.

The semantics of `--strict`: packaging completes as usual, but if the report contains any "not packed" item or extra plaintext exception, it exits with a non-zero code. Suitable for automation — exceptions must be explicitly acknowledged by a person, not discovered by digging through logs to find "a few files did not make it into the package".

## 3. Place the whole package into the shell's resource directory

Put lfenpack's output directory wholesale into the app's `resource_dir()/Resources/`. In the formal distribution form there are no more environment variables at this point: on startup the shell finds the resource root, reads the plaintext manifest, sees `resourceEncryption: true` and assembles the encrypted supply, and the page fetches bytes on demand through the in-shell protocol.

Three self-check criteria: the page renders fully, the console has zero errors, and no plaintext business `js` / `css` can be found by searching the executable and the package.

## Current state and limits

State clearly what is missing now, so you do not discover it after trying for a long time:

- **No single command chains the three steps.** Encrypted build, packaging, and placing into the resource directory are three manual actions. The build flow only hooks "build + finishing"; there is no packaging step.
- **The default build does not encrypt.** Without that environment variable, `pnpm tauri build` produces a plaintext package — it looks the same as the encrypted one but the source is directly readable.
- **Encrypted supply exists only in the reference host's (playground) desktop shell.** The desktop shell that comes with the scaffold template is a plaintext reference implementation; neither resources nor saves are encrypted, and delivering security requires bringing your own Rust encryption layer. The browser form does no encrypted supply, and the editor only opens plaintext projects — hand it a ciphertext directory and it will simply say it cannot open it.
- **playground's resource encryption is casual-level, not cross-machine unbreakable.** The key seed (`__key__.seed`) is the plaintext DEK distributed with the package; unpacking to get it lets you decrypt all resources offline, without depending on the target machine's key. It prevents casual copying and preserves package-update following; against a package holder it only raises the cost and does not promise extraction is impossible. The key-acquisition policy is a pluggable seam (the composition root picks the default adapter); **delivering strong DRM requires choosing a stronger provider yourself (online activation / white-box / license binding) or bringing your own online activation**. Saves, by contrast, are MachineBound (cross-machine unbreakable) — keep the two semantics separate.
- **The packaging machine needs the Rust toolchain.** `lfenpack` is a separate binary, not a runtime component distributed with the package.

## Related

- [Encryption and platform supply](/concepts/encryption/) — the three-layer split, which layer holds the key, and what the shell-less form lacks.
- [Project manifest project.json](/reference/manifest/) — the full description of the `resourceEncryption` field and `frontend.assets`.
- [Resources directory conventions](/reference/resources-layout/) — which directories belong in version control and which are runtime artifacts.
