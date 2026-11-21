---
title: Encryption & Platform Supply
description: The engine only declares capabilities; the composition root decides which implementation to install, and keys stay in the platform layer. Where each of the three faces — resources, translations, saves — is completed, what the shell-less forms lack, and why extensions cannot reach keys.
---

Encryption is not a switch inside the engine. The engine only declares what it needs; the composition root decides which implementation to install, and keys and crypto stay in the platform layer. Where each of the three faces — resources, translations, saves — is completed within that layer is described separately below.

## Three-layer division of labor

The same requirement, "resources must be encrypted", becomes a different thing in each of the three layers:

| Layer            | What it does                                                                                                                         | What it does not know                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Engine           | Declares contracts. Resources need a usable address, translations need a batch of entries, saves need a readable/writable slot port. | Whether a resource is plaintext or ciphertext, where the keys are, how many there are. |
| Composition root | Reads `project.json`, looks at `resourceEncryption` and the host form, and decides which implementation to assemble.                 | Holds no key material and does no crypto.                                              |
| Platform layer   | Holds keys, decrypts, and lands the result as something the platform can use directly (an address, bytes, a slot file).              | Which column the story is on, what a wait point is.                                    |

Changing the host form only touches those two lines in the composition root. The engine-side wait points, checkpoints and replay have nothing to do with encryption and need not change a word.

## The resource port only wants an address

The story writes `bgm "Audio/main.mp3"`; this line is identical in a plaintext project and an encrypted one. The difference is in the resolution step:

```ts
const url = await resourcePort.resolve("Audio/main.mp3");
```

`resolve()` only requires returning an address that is usable right now:

- The static-root form concatenates the path directly and returns `/Audio/main.mp3`.
- The encrypted form decrypts and then returns a short-lived address that expires after use.

Before you get it you do not know which is behind it, and you do not need to. `release(url)` is the slot left for the second form — a static address has no resident handle, so the implementation is empty; a temporary address is reclaimed here.

Two failure semantics are worth remembering:

- Resolution failure must throw, not return a bad address. The caller is fail-closed: better not to play than to play the wrong thing.
- In the ciphertext form there is no directly referenceable resource file on disk, so the engine forbids writing resources as static direct references; every resource goes through `resolve()`. The story can only write logical paths.

## The honest scope of resource encryption (casual level)

The reference host playground's resource encryption is **casual level**, not "unbreakable across machines": the package root holds a plaintext `__key__.seed`, which is the resource DEK. Unpacking to obtain the seed lets you decrypt all resources offline, **without the target machine's key** — the KEK envelope is only a runtime cache and does not form a cross-machine barrier. This layer defends against casual copying (copying the resource directory at random yields nothing openable) and preserves "package update = new seed followed automatically". Against a package holder it can only raise the cost; it **does not promise non-extractability** (runtime memory extraction, screenshots and screen recording are fundamentally undefendable).

The key-acquisition strategy is a **pluggable seam**: the security layer defines a `ResourceKeySource` port, the crypto core only consumes DEK bytes, and the concrete strategy is chosen by the composition root at build time (default adapter: in-package seed). To deliver strong DRM, pick a stronger provider yourself (online activation / white-box / license binding) or bring your own online activation — change that one line in the composition root, with zero changes to the crypto core.

**The save scope is different**: save LFS3 uses a per-save random DEK + KEK wrapping + a high-water mark against rollback, defaulting to MachineBound (unopenable across machines). Resource casual and save MachineBound are two independent scopes; do not conflate them.

## Translation decryption belongs to the supply side

What `i18nPort.loadOverlayFiles(lang)` returns is "path + entries"; there is no "plaintext or ciphertext" field — that is not for the engine to judge. `Lang/en/main.json` and `Lang/en/main.json.enc` are the same thing to the engine: entries handed up by the supplier.

So:

- When you write the supply yourself, decryption is also done on your side.
- For ciphertext to be decryptable, `project.json` must declare `resourceEncryption: true`. Once declared, ciphertext is decrypted as usual and participates in the merge; if ciphertext appears without the declaration, the whole load is treated as failed, and the engine emits `i18n-overlay-failed` and keeps the original language.
- The desktop shell's supply completes collection, reading and decryption in the native layer; by the time it reaches the engine it is already entries.

Translation files and story files share the same resource root and the same encryption declaration; no separate set is opened.

## Save mode is the security scope

`SavePort` has only four methods; writing carries a mode argument:

```ts
savePort.write(slot, payload, mode);
```

`mode` takes one of the two values of `SaveMode`, and it is simultaneously the save's security scope:

| Mode                      | Copying the save to another machine                        |
| ------------------------- | ---------------------------------------------------------- |
| `machine-bound` (default) | Cannot be opened. The ciphertext is bound to this machine. |
| `portable`                | Can be opened; it travels with the file.                   |

The engine hands `mode` to the port verbatim; it does no crypto itself and does not know the keys. So "whether a save is secure" is decided in the port implementation, not in the story.

Two consequences directly relevant to the player:

- Default saves do not cross machines. To let the player manually move progress to another device, you must explicitly choose `portable`.
- Deleting a save does not roll back the anti-rollback baseline. Saves carry a write count; deleting a newer save and then reading an older one is refused — otherwise deleting saves would become a back door for rollback.

This scope only counts once it lands in a port implementation. **The desktop shell bundled with the scaffold template does not implement it**: saves are plaintext JSON, the `mode` argument is accepted but produces no ciphertext, and there is no anti-rollback high-water mark. Key custody, per-save independent keys, and rollback protection (security requirements K1–K8) are only implemented in the reference host playground. To deliver security, bring your own Rust encryption layer, or wait for the security stack to be crate-ified and wire it in.

## What the shell-less forms can do

In a browser there is no such thing as "the app brings its own key": once a key enters front-end code, anyone can see it. That does not mean the web form cannot do encryption; it only means the key needs a different source — let the player type it, or fetch it from your server.

The technical route works: fetch the ciphertext, decrypt to plaintext with WebCrypto, create a temporary address with `URL.createObjectURL()` and hand it to `resolve()`, then revoke it in `release()`. The path is the same as the desktop-shell form; only the decryption happens in the page.

But the current state must be stated clearly: **this implementation does not exist yet**. Encrypted supply exists in both the desktop shell and the mobile shells (Android/iOS) of the reference host (playground) — the desktop shell bundled with the scaffold template is a plaintext reference implementation, with neither resources nor saves encrypted; the web form does not even have unencrypted static-root translation supply yet — translations in the `Lang/` directory are not read, and the original text is shown directly. The above is a feasible path, not ready-made code.

The editor's stance is consistent: it only opens plaintext projects. When story files are ciphertext, it tells you directly that it cannot open them and asks you to choose a plaintext project directory — the browser side has no keys, and it does not guess.

## Extensions cannot touch keys

The context an extension receives has only two things: state read/write (`get` / `set`), and a read-only story tree.

No file system, no resource port, no save slots, and no keys. So:

- An extension cannot read files under `Resources/`. For resources, a story command must fetch them.
- When an extension writes state it is forced to carry its own namespace prefix, so it cannot modify anyone else's keys.
- Conversely, state is readable by extensions. Do not stuff keys, tokens and the like into state — extensions can read them, and rollback and saves would carry them along too.

The only entry point for keys is that one in the platform layer; extensions are not on that path.

## Related

- [Multilingual & translations](/concepts/i18n/): where translations come from, and how ciphertext translations participate in the merge.
- [Save system](/concepts/saves/): slots, modes, and what loading blocks.
- [Project manifest project.json](/reference/manifest/): the full description of the `resourceEncryption` field.
