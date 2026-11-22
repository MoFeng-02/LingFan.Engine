---
title: Changelog
description: The LingFan engine's change highlights recorded by version — what each version added, improved, and fixed, and where to find the full commit list.
---

Change highlights recorded in reverse version order. This page keeps only what readers need to know — the full description and commit hashes for each change live on the corresponding version page of GitHub Releases; the links are under each version heading.

## Unreleased

No unreleased changes.

## v0.7.2

2026-11-22 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.7.2)

### Added

- **Auto-play spreads its dwell time by sentence length**: previously every line waited the same fixed duration, so a long line flipped before you finished it and a short one made you wait for nothing. Now each line's actual dwell is base dwell + that line's token count ÷ reading speed — long lines linger, short ones move on. The new `autoReadCps` preference (tokens per second, default 12, range 1–200; the lower bound is not 0 because it is a divisor and 0 would make the dwell infinite) comes with `setAutoReadCps` / `clearAutoReadCps`, and `autoDelayMs` narrows to "base dwell". Token counting: each CJK character counts as 1, each contiguous run of Latin letters or digits counts as 1, and whitespace, punctuation, and inline markers count as 0. Both preference panels gain a "reading speed" slider.
- **The render layer exports token counting and dwell math**: `countReadingTokens` and `autoDwellMs` are exported as pure functions so hosts can reuse the same rules, `Typewriter` gains `readingTokens`, and the `TypewriterReader` surface gains an optional `readingTokens` — **optional on purpose**: an early host's existing implementation should not stop compiling just because a required field appeared, and when it is absent the engine falls back to counting the current line itself.

### Fixed

- **The font-name allowlist now accepts hyphens and dots**: it used to accept only `\w` and CJK, while real font names in the wild look like `SourceHanSerifCN-VF` — every one of them was judged illegal and silently fell back to the default font, breaking `{font=}`, per-line fonts, and the player font preference all at once without a single error. Font-family projection now passes the registry check before reaching the CSS variable, and unregistered names fail closed.
- **The template's font slot is now a live control instead of a disabled placeholder**: its options come from the build-time scan, the selection is validated against the registry before projection, and the template assembles the font-name registry too, so `{font=}` and the player font preference go through the same check in scaffolded projects.

### Other changes

- **Template version**: `1.26.0` → `1.28.0` (`1.27.0` wired the font chain and three preference setters, `1.28.0` wired playback pacing), with `minEngineVersion` raised from `0.5.0` to `0.7.1` — the old value was already an underestimate: APIs the template calls, such as `setDialogueHeightScale`, simply do not exist in 0.5.0.
- **Template dependency ranges**: `^0.4.0` → `^0.7.1`, aligned to the then-current version in one step.

## v0.7.1

2026-11-22 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.7.1)

### Added

- **The font registry scans subdirectories recursively**: fonts are normally filed by category (`OTF` / `TTF` / `WOFF2`), but only the top level of `Resources/Fonts/` used to be scanned, so nothing in a subdirectory ever reached the registry — which is why the font dropdown stayed a dead control. The scan now walks every level, and `file` changes from a bare file name to a path relative to the font root, which hosts use to build resource URLs. The same family may ship in several formats (`.otf` and `.ttf` under one name); the host emits one `@font-face` per file and the browser picks the format it supports.
- **Three preference setters for auto-play and skip**: `setAutoEnabled` / `setAutoDelayMs` / `setSkipUnseenOnly` enter `PlayerPreferences`, turning playback pacing from "each host figures it out" into an engine capability.
- **Template playback pacing wiring**: auto-play, auto delay, and skip-read-only go from disabled placeholders to live controls read in real time by the host pacing loop.
- **Playground façade**: the start page gains language switching and a resume summary, the toolbar's Auto / Skip become visible live controls, the opening becomes a narrative prologue, and there is a new feature-tour chapter (seen-and-skip, multi-instance audio, no-rollback segment, minigame and interaction branching) plus six expression variants of a portrait, and a PixiJS real-time scene column as a column body component.

### Improved

- **`.story` write-back policy settled**: storage is always JSON; the text form of `.story` is an authoring input format that is normalized on save, the path stays as authored (`.story` writes back to `.story`), and the form is detected from the file's first character. The earlier test assertion of "the text form stays byte-identical" rested on the opposite premise — text projection drops comments and hoists `define` lines to the top of the file, so it cannot be byte-idempotent and should not try to be. The assertion now buckets by form: JSON form stays byte-identical, while the text form asserts that the diff set is exactly those files, that re-assembling the written result deep-equals the original story, that nothing is deleted, and that the file set is unchanged.
- **The font type surface deduplicates by font name**: one font often ships in several formats and the registry records one entry per file, while the type surface keys on the font name — without deduplication the same key would repeat across lines.

### Other changes

- **Gates**: prettier now explicitly ignores the session-artifact metadata directory (it is only excluded locally by `.git/info/exclude`, which prettier does not read).
- **English element pages**: a colon in a description is now quoted, fixing a YAML frontmatter parse failure.

## v0.7.0

2026-11-21 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.7.0)

### Added

- **Player preferences become an engine capability**: settings such as volume, text speed, typewriter, dialogue box opacity / position / height / font scale, element fill defaults, keybindings, screen orientation, fullscreen, and font family used to be reimplemented by every host. The engine now provides a `PlayerPreferences` contract and a three-way consumption chain (preferences > story > built-in); hosts only own the panel, and changes take effect immediately. Defaults written in the story are the "player has not spoken yet" layer — once the player sets something, the story no longer overrides it.
- **Machine-level seen records with skip and auto-play**: seen records live independently of preferences, saves, and story state — shared across saves, not cleared when a save is deleted, not captured in snapshots. That is what "seen" should mean: once read, it stays read, even if you later load an older save. Skip and auto-play go through exactly the same advance seam as player clicks, so the existing constraints (no advancing during rollback, interface scenes step aside, story-level unskippable gates, stop on unseen) hold automatically; the mode itself is session state, so neither loading a save nor rolling back leaves residue.
- **Rollback control surface**: an assembly-time `rollbackEnabled` master switch (defaults to `true`, current behavior unchanged), a session-level temporary lock `SYS.rollbackLocked` (captured in snapshots, not in saves), and two ops — `block_rollback` / `fix_rollback` — so authors can mark "this stretch cannot be rolled back" at segment granularity. When rollback is unavailable no checkpoint is created; saving and loading still work. A project-author-level `historyLimit` is also new: invalid values degrade to the default with a diagnostic, and loading a save walks every history checkpoint — if one cannot be migrated the list is truncated and the player is told.
- **Host capabilities become assembly-time pure data**: `HostInfo.capabilities`, optional and additive. A body component declares what it needs; if the host does not declare that capability the engine diagnoses and stops rendering — no silent degradation, because a degraded screen is harder to debug than an error. Capability comparison reads two pure data lists and probes no platform.
- **Security**: resource DEK acquisition moves from a hardcoded endpoint to a port + adapter seam; the default is still the in-package seed (honestly labelled casual grade — the seed ships in plaintext with the package and makes no promise of unextractability), so a stronger provider can replace it later without touching the crypto core. The save header is upgraded to authenticated encryption (mode, counter, and timestamp are authenticated; tampering fails, old saves still read); saves, high-water marks, preferences, and persistence all use atomic writes (temp file + rename, so a crash never leaves half a file); the iOS Keychain item is marked as available only after local unlock, the KEK cache switches to a short TTL refetched on demand with copies zeroed after use. The desktop shell CSP tightens to least privilege (no `unsafe-eval`), save-slot validation is fail-closed, and the debug channel gains an origin allowlist plus token handshake.
- **Cross-platform**: mini-program video fills the real stage size and expresses instance layering as page data; the template and mini-program build targets drop to safari13, and the legacy-WebView denylist guard extends to both.
- **Scaffold host wiring completed**: body component assembly, preference consumption, keybindings and wheel / Esc / quick save-load on the input surface, a start-page continue slot, real minigame mounting, extension registration, screen-orientation and fullscreen policy moved down, mini-program settings panel and accessibility.

### Improved

- **Anchor interlock expansion**: regulation anchors whose behavior is already tested are enlisted (31 → 51), with exact bidirectional equality assertions; the interlock rate only grows.
- **Contract layer free of implementation dependencies**: the contract barrel no longer re-exports back from the decision layer; consumers import directly. Only import paths change, behavior does not.
- **Single column-change interruption path**: entering a column and leaving the element-sequence path share one interruption function, so a direct `jump` no longer drops the external-takeover signal.
- **Checkpoints only marked after a real commit**: the "already recorded" flag is set only when a checkpoint actually lands; anything dropped by a guard stays unmarked.
- **Test probe races**: anchor and story-source probes now run against per-test temporary copies, so the real project tree sees zero writes and parallel runs stay green.

### Fixed

- **Op self-consistency**: `audio_seek` added (instance or channel, one of the two); `audio_pause` / `audio_resume` support the instance dimension; `audio_volume` extends to instance and channel targets. The media family's stop / pause / resume align; `video` / `cutscene` continue by default when the resource is unchanged, and `restart` replays explicitly.
- **Load-time validation**: 23 + 1 ops gain fail-closed validation at the parse layer; extension `stateVersion` gains integer validation; the loose criteria of `character` / `nvl` / `video_skipable` are tightened; `text_typewriter` keeps `enabled` on merged writes.
- **Creation-chain type surface**: `label` column collection aligns with the narrowed column-name surface — `option` targets and the second `navigate` argument are collected too, and a `flow` column is produced when they point at an exported function; `call` targets narrow to a union of "known column name or known function name", with the function-name table entering the compile-time type domain.

### Other changes

- **Docs**: regulation snapshots synchronized (op set final at 76, five sources equal); English docs go from 15 real translations + 25 fallbacks to 40 real translations (zh-en reconciliation 40 = 40, no fallback left), with technical terms (op names, error codes, APIs, commands, field names) never translated; a new doc-snapshot guard test pins the numbers in regulations and docs so they cannot drift silently.
- **Template version**: `1.25.0` → `1.26.0`. The template content changed (host wiring completed, body assembly, security policy), so the version number is raised; the engine version line is independent.

## v0.6.1

2026-11-18 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.6.1)

### Fixed

- **The scaffold history panel collapses when switching language**: switching used to remount the whole block, so an expanded history list folded shut and the scroll position was lost. It now repaints in place (`refresh()`), keeping the expanded state and scroll position and re-translating only block content and button labels. The preferences panel has no expanded state to lose and still remounts as before.

### Improved

- Element translation comments corrected to the derive-at-read criterion: display text is stored as original text in the single source of truth, re-derived as soon as the language changes, no reload needed.
- Overlay merge comments corrected: the override order is supply order, not file-name order — the supplier passes them already sorted by disk order and the merge itself does not sort.
- The "single declaration of the default language" criterion now scans template overlay composition roots too (vue / react / tauri / story forms).

### Other changes

- **Docs**: the README notes that the Rust backend is optional.

## v0.6.0

2026-11-18 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.6.0)

### Added

- **Scaffold hosts wired for multilingual**: the scaffold's bundled hosts (native / Vue / React, three forms) and the mini-program form are all wired to translation supply and a page language selector — dropping translation tables into `Resources/Lang/` takes effect, host static copy such as the toolbar and save labels repaints on language switch, and the preferences and history panels switch language in sync. The language list comes from a build-time scan, so adding a language directory needs no list change; the project ships an English example translation table. For usage see [making a multilingual project](/guides/i18n/).
- **Command-line toolchain `lingfan-i18n`**: four subcommands — `scan` for the key list, `skeleton` to generate/update translation skeletons (idempotent incremental), `report` for single-language reconciliation, `check` for reconciliation plus an exit-code gate (`--fail-on=missing|unused|any`, directly CI-ready). Supports `--functions` to register translation-function aliases, `--json` for machine-readable output, and `--prune` to clean up orphan keys with no source. See [making a multilingual project](/guides/i18n/).
- **Host facade `createHostI18n`**: `@lingfan-engine/shell` adds a facade factory that wires host interface copy to the same translation supply as the engine — `t()` for lookup, `changeLang()` to switch language, `subscribe()` to subscribe to language changes, and `availableLangs` for the selector's list. A factory, not a singleton; the facade does not hold the translation table. For the API and wiring see [multilingual and translations](/concepts/i18n/).
- **Localizable injection points for the notification center and option views**: both add an optional `translate` injection (usually `engine.translate` or the facade's `t`); once injected, the components' built-in player-visible copy (such as "Saved" and the input box's "OK") also goes through the translation table; without injection the behavior is exactly as before. The old `texts` copy keys are kept as a miss fallback and host-override entry point, marked deprecated and to be removed in a later version.
- **Two new diagnostic classes in the translation health check**: **unmarked host copy** (literals in host source that contain Chinese but are not wrapped in `t()`, each given with file and line/column position) and **layout conflicts** (the same key taking different values across files in the same language, where last-write-wins silently shadows). The health check's comparison surface also extends to host static copy keys.

### Behavior changes

- **Interface files no longer support `.html`**: an interface file must be a module that can be default-imported, and HTML is not an ES module, so it cannot fit this channel. Previously the build did not error and only said "the interface did not mount" at runtime, a wasted wait; now the build rejects outright and explains what to use instead. Existing `.html` interfaces should be rewritten as one of `.vue` / `.tsx` / `.ts`.
- **Saves and state store original text, no longer translations**: dialogue, menus, input, NVL, and element text are uniformly stored as original text in the state container, snapshots, and saves; translations are derived against the current translation table at the moment of reading. After switching language the **current screen re-translates immediately** (including on-screen element text and the history panel); what language is shown after loading a save depends on the language setting at load time. The save format (`SaveDataV1`) field set is unchanged; old-version saves stored translations, and on read the engine marks suspected-translation fields in memory and skips lookup, avoiding re-translating a translation as if it were original; once the engine rewrites the field the mark clears — old saves downgrade automatically, no migration needed.
- **Known boundary: for sentences containing `{variable}`, the translation target is the template**: for interpolated sentences in speaker names and body text, lookup uses the original template (such as `Hello, {name}!`) rather than the interpolated result; on derivation the template translation is taken first, then the variable values captured at the time are interpolated back. The variable values themselves are not translated.

### Improved

- After a language switch the current screen (dialogue, speaker, menus, input, NVL, elements, history panel) re-translates immediately, with frame-stack depth and column coordinates unchanged — no replay.
- `setLanguage` converges into a seven-step flow (validate language → supply table → write current language → re-translate visible surfaces / elements / NVL → emit); concurrent switches are last-write-wins, and a failed supply keeps the original language and table while emitting an error event (fail-closed).
- The default language constant and the `Lang` directory name move into core as a single declaration.

### Fixed

- Legacy-save detection rejects cleanly instead of throwing on a bad payload (state field not an array or missing).
- Concurrent language switches: an idempotent early return no longer lets a suspended old request beat the newest one.

### Other changes

- **Template version**: `1.18.0` → `1.19.0`. The template content changed (the three forms and the mini-program host wired for multilingual: translation supply, language selector, static copy repaint, English example translation table), so the version number is raised; the engine version line is independent.
- **Docs**: the interface-file extension list in the story-source chapter drops `.html`, with a sentence added on why (interface files must be default-importable).
- **Docs**: the two multilingual pages (concept and guide) are rewritten to the new semantics — when it takes effect, the host facade, the command-line toolchain, health-check diagnostics; corresponding English pages added.

## v0.5.1

2026-11-17 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.5.1)

### Other changes

- **Template version**: `1.17.0` → `1.18.0`, with the minimum engine version raised to `0.5.0` (the template starts using APIs from that line).
- **Repository**: the ignore list and end-of-line attribute comments are trimmed.

## v0.5.0

2026-11-17 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.5.0)

### Added

- **Body components**: a column declaration gains an optional `body` field, mutually exclusive with `elements` — a column is either "elements the engine places" or "your own component", never both. A `scene` column loads its body as declared and writes a system key; a `flow` column without a body declaration keeps the previous screen. Changing columns clears the old body without entering the mount table. Body frames never enter the waiting state and create no checkpoints, so rollback falls back naturally along the existing coordinate rules. A companion `SceneEnv` contract defines which engine capabilities a body component receives.
- **Build-time scene scanning**: the `scenes/` directory collects body components by the "directory name is the component name" convention and generates a scene registry; an `export function` referenced by a static literal in `jump` / `navigate` produces a `flow` column on demand.
- **Op payload types and word functions move down to core**: hand-written payload type aliases, `CommandOf` conditional dispatch, per-domain payload maps, and word functions moved over verbatim; the core barrel re-exports the narrowed registry surface and gains a `./script` source-direct entry. Core stays zero-dependency and zero-DOM — op payload types are declared once, in core, and word functions reference no runtime.
- **Test interlocks**: bidirectional op payload locks (assignable both ways plus key-set equality), a spine interlock (count / landing / name-set completeness / export identity), registry narrowing probes, and a real-value consumption journey (word function → parse → execute → observe state, without going through the editor). Existing assertions are not weakened.
- **Playground**: a new sandbox-map showcase chapter (world map, hall, kitchen, study body components with matching story columns) and five SVG scene resources; the host wires body loading and `SceneEnv` injection.

### Fixed

- **Editor**: diagnostic classification distinguishes "missing field" from "wrong type" per zod v4.
- **Publish check**: the tar listing tolerates CRLF line endings and verifies that `exports` subpath targets actually exist.

### Other changes

- **Interface files must be default-importable modules**: HTML is not an ES module and cannot fit the UI channel. Previously the build did not error and only said "the interface did not mount" at runtime; the build now rejects outright.
- **The editor's vocabulary layer forwards to `core/script`**: type exports forwarded, word functions moved out, zod schemas demoted to validators (with `satisfies` type annotations). The package barrel surface is unchanged, so existing story-source imports are unaffected.
- **Four build-time emitters** (type generation / unit / scene / interface registry) move their `declare module` augmentation target from the editor to core, landing in the same batch as the registry move.
- **Gates**: the pure-layer DOM guard extends to the engine core layer; specifier extraction no longer treats field names as external dependencies.
- **Docs**: the "template not wired yet" wording for `shell.stage` is removed.

## v0.4.2

2026-11-12 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.4.2)

### Added

- **Jump straight to a column in the story during development**: give the dev command a column id to skip the start page and enter that column directly, without "change a line → restart → walk ten minutes to reach that line." The value is a **column id**, not a file name — column ids are unique within the project and can span files, while file names often do not match them. If unsure which columns exist, list them first with `--list-entries`. For the argument syntax across the four package managers and "what gets left out," see [running one column](/guides/run-one-column/).
- **Scaffold artifacts support this channel too**: projects built by the generator have the template host wired for jumping past the entry column (the engine already had the "jump to a given column" capability; the engine is unchanged). Template projects ship two example columns, so you can try it without compiling the story first. The mini-program form is not in this list — its dev command is managed by the mini-program toolchain.
- **Package-manager matrix into CI**: use a locally packed scaffold to generate an example project, then run install, story compile, and pack once each under npm / pnpm / yarn / bun. What ships is packages, not the repository, so someone has to watch this layer on behalf of users.

### Fixed

- **Story source reporting "cannot find name state" / "cannot find name defineVars" in the editor**: the editor picks the type project by "the nearest `tsconfig.json` to the file," and the host project happens to exclude the story source, so chapter source falls into the project the editor infers on its own, where those ambient globals are absent. Command-line type checking was green before; only the editor was red — now both agree. Projects with the Vue / React forms installed benefit too.

### Other changes

- **Template version**: `1.16.0` → `1.17.0`. The template content changed (the three-form hosts wired for chapter direct-jump), so the version number is raised; the engine version line is independent.
- **Docs**: a new "running one column" guide; a paragraph added to the story-source chapter — why the editor surfaces "cannot find name state" while command-line type checking is clean, and what the nearest type project is for.

## v0.4.1

2026-11-10 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.4.1)

### Fixed

- **`mount(handle, …)` reporting "a component cannot be assigned to a handle" in the editor**: if the story source default-imports an interface component from a `.vue` / `.tsx` file, the editor (and vue-tsc) resolves that import to a real component type rather than an interface handle, so the first argument type of `mount()` does not match. Command-line type checking was green before; only the editor was red. Interface handles are now taken from the named exports of the build artifact `src/gen/ui_register.g` — this path does not go through component resolution, so editor and command-line results agree.

### Other changes

- **Interface handles in new projects no longer default-import component files**: the example columns of the Vue and React forms now take handles from the artifact, and the project ships an interface registry, so handles are available before the first build — no need to build first and then change the approach.
- **Docs**: a sentence added to the UI-mounting chapter — when writing story source in the editor, take handles from the artifact.
- **Template version**: `1.15.0` → `1.16.0`. The template content changed (the example columns of the Vue and React forms now take interface handles from the artifact, each shipping an interface registry), so the version number is raised; the engine version line is independent.

## v0.4.0

2026-11-09 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.4.0)

### Added

- **Stage adaptation: `shell.stage` becomes a portable contract**: the design baseline, scaling strategy, alignment, and bounds sink into the contract and resolver of `@lingfan-engine/core`; `@lingfan-engine/shell` provides the pure computation `computeStageLayout` / `stageTransform` and the orchestration `createStageFitter`. The host only provides the two platform actions "read the viewport, write the style"; the computation reads no platform globals, so the desktop shell, browser, and mini-program share the same criterion.
- **Template hosts wired for stage adaptation**: the scaffold's bundled hosts (native / Vue / React, three forms) now actually read `shell.stage` — the baseline-pixel composition scales proportionally at any window ratio, and host UI stays in window coordinates without scaling along. Previously this config was "written but not effective" on the template.
- **Neutral vocabulary for image fill**: the five element kinds — image, image button, portrait, video, background — share one `stretch` attribute, with the value domain collapsed to five words (`fill` / `contain` / `cover` / `none` / `scale-down`), aligned with CSS `object-fit` but not word-for-word identical. Each of the three ends maps its own: the browser writes `object-fit` or `background-size`, the mini-program degrades to its platform's three-value capability, and the editor shows a dropdown. The engine stores only the word, not a CSS string.
- **Edit-time diagnostic `invalid-element-fit`**: writing a value outside the vocabulary for `stretch` falls back to the default and also reports a warning in the diagnostic panel, no longer silent.

### Behavior changes

These change the picture of existing projects; worth a look before upgrading:

- **Images without `stretch` go from "original size" to "fill and crop"**: previously image elements produced no `object-fit` and the browser displayed by default behavior; now the default is `cover`. When the author-coordinate frame and the image ratio disagree you will see cropping (previously stretching or letterboxing, depending on element type). To keep the original look, write `stretch="contain"` or `stretch="none"` on the element.
- **Background elements go from "invisible" to "fill the stage"**: background elements were previously a `div` with no width or height, leaving `background-image` nowhere to spread; now the engine writes its frame as `100% × 100%` (as big as the stage), and the image fills with the default `cover`. This is the effect most wanted in this version, but it means the picture of every historical project using `background` / `bg_switch` changes.
- **Video default fill goes from `contain` to `cover`**: previously the video port hard-wrote `object-fit: contain` into the stylesheet, letterboxing top and bottom in non-16:9 windows; now it follows the element declaration, defaulting to `cover` to fill and crop. To remove cropping, write `stretch="contain"` on the video element.

### Improved

- **Stage layering in the template host**: `#stage-root` changes from `fixed` to `absolute` (hung inside `#stage-viewport`), and screen shake moves from the stage root to the middle layer `#stage-shake` — scaling is written on the stage root, shake on the inner layer, so the two no longer overwrite each other.
- **Template host UI sizes become responsive**: the positions and font sizes of the dialogue panel, options, notifications, toolbar, and error hints change from fixed px to `clamp()`, no longer overflowing or truncating in small windows. The stage element layer (`#stage` / `#stage-root` / `#stage-shake` / `#stage-viewport`) keeps the baseline-pixel criterion, with not a single `clamp()` written — scaling must be solely responsible there.
- **Template-copy consistency into the gate**: the file lists and contents of the two trees `template/v1` and `packages/create/template` are compared byte-for-byte in tests; changing one side and forgetting the other goes red directly.

### Fixed

- **`stretch` was previously an empty form**: declared in the contract and given a form in the editor, but with zero consumption in the render layer — writing it had no effect at all. This version wires it into the render layer, so values like `stretch="cover"` actually take effect from now on.

### Other changes

- **Docs**: the "template has not wired it" wording for `shell.stage` is removed; a "media fill" subsection is added to the elements chapter, explaining the five words, the three-end mapping, and the two platform degradations; the template capability-boundary table moves "stage adaptation" from "not wired" to "wired"; a new [screen adaptation](/guides/screen-adaptation/) topic starts from "how does my game adapt to both phones and large screens" and covers the three coordinate systems, baseline config, and host wiring.
- **Template version**: `1.14.0` → `1.15.0`. The template content changed (the three-form hosts wired for stage adaptation, stylesheets made responsive), so the version number is raised; the engine version line is independent.

## v0.3.7

2026-11-08 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.7)

### Added

- **Template ships a UI-mounting example**: projects generated in the Vue and React forms each have a hint-bar interface under `src/ui/hint/`, mounted with `mount(hint, true, { text })` in `src/Stories.src/title/look_around.ts`. Choosing "look around" in the entry menu shows the effect; editing this column takes effect immediately, without first understanding the whole mounting chain.

### Other changes

- **Docs**: a "mounting UI" section added to the story-source chapter, explaining the hard rule that the interface's directory name, file name, and import binding name are all the same, that `mount()`'s argument is a wholesale replacement and must be storable in a snapshot, and that engine operations go through `controls`; plus a section on what the project-root `tsconfig.json` and `tsconfig.stories.json` each govern — the former lets the component compiler handle host pages, the latter uses pure `tsc` for story source.
- **Template version**: `1.13.0` → `1.14.0`. The template content changed (each of the two forms gains a UI example), so the version number is raised; the engine version line is unaffected.

## v0.3.6

2026-11-08 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.6)

### Fixed

- **Generated-project type checking mistook story source for components**: in projects generated in the Vue, React, and mini-program forms, the root `tsconfig.json`'s check surface covers all of `src/**`, and that config is handled by the component compiler (Vue recognizes `.vue`, React recognizes `.tsx`). So when story source `import`s a component and passes a component handle to `mount()`, the component is resolved to a real component type, overriding the engine-declared handle wildcard and judged a type mismatch — a project writing UI mounting per the docs errored as soon as it ran `typecheck`. Now all three forms' project configs exclude `src/Stories.src/**` from the component check surface; story source is checked by its own `tsconfig.stories.json` with pure `tsc`, and `stories-typecheck` still covers it; host pages remain in the component check surface, so a type mistake in host changes still errors.

### Other changes

- **Template version**: `1.12.0` → `1.13.0`. The template content changed (the three forms' project `tsconfig.json`), so the version number is raised; the engine version line is unaffected.

## v0.3.5

2026-11-08 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.5)

### Added

- **Project-manifest description field**: `Resources/project.json` can carry an optional `description`, a one-liner shown to the player. It does not participate in addressing or affect title resolution; the engine only validates the type; an empty string is legal, and omitting the key still loads normally. The description the generator asks for is written into both `package.json` and the project manifest.
- **Generator becomes question-driven creation**: the command carries only the project name; the rest is asked in order — project name, description, form multi-select. Multiple forms can be selected at once; which layers can stack is decided by the template's mutual-exclusion declarations, and selecting an exclusive combination explains on the spot and re-asks; the description can be left empty, and if filled it is written into the two manifests above. When standard input is not a terminal and there are still items to ask, it fails explicitly rather than silently hanging. `--template` is kept for script usage and does not participate in exclusion validation.
- **Hand-written story example becomes purely additive**: the overlay no longer removes the skeleton's TS authoring chain; it only adds a hand-written example `Resources/Stories/manual/manual_intro.story`. The example column id falls in the `manual_` namespace, not colliding with the skeleton's own columns. The form questions narrow accordingly to page structure and shell; `--sources story` can still specify the story source but does not occupy an option slot.

### Improved

- **Release-note generation**: the body is itemized by paragraph; process records like `验证：` / `测试：` are dropped wholesale and no longer mixed into release notes; `功能` is classified into the "Added" type.

### Fixed

- **Story-artifact cleanup**: previously any file under `Resources/Stories` not in this round's artifact set was deleted outright, which also deleted hand-written `.story` and hand-written JSON columns. Now it reads the previous round's artifact ledger (project-root `.lingfan/stories-build.json`) and only deletes files it wrote itself that this round no longer produces; when the ledger is missing, nothing is deleted. Hand-written files are from now on out of the cleanup scope.

### Other changes

- **Docs**: generator usage becomes three-question flow, with script usage collected into a separate subsection; the manifest reference adds the `description` field description; the template-skeleton description is synced; the form table collapses from five items to four (Vue 3, React, desktop Tauri 2, mini-program UniApp), with an added explanation of the three authoring forms coexisting — TS source, hand-written `.story`, and hand-written `.json` land on the same `Resources/Stories/` tree, scanned together at build time, and can be mixed. "Change a line of dialogue" previously told readers to open a `.story` file that does not exist in the skeleton; it now reads `src/Stories.src/title/title_main.ts`, explaining that you must run `pnpm stories:build` and that editing `.json` directly is overwritten by the next build; the resource-layout example is replaced with real skeleton files; the template version is raised to 1.12.0.

## v0.3.4

2026-11-07 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.4)

### Added

- **Generator supports `--template`; story source is no longer asked**: story source only recognizes arguments — `--sources story`, or the third segment of `--template <framework[-shell[-story-source]]>`, defaulting to `ts`. `--template` specifies the form at once; per-item arguments still take priority. When the target directory is non-empty, it interactively asks keep / clear / cancel; `--overwrite` is non-interactive clearing, and `--yes` errors out directly on a non-empty directory rather than making the overwrite decision for you. Dependencies are not installed by default; pass `--install` to install, and the old `--no-install` is still recognized.

### Fixed

- **Dependency pinning**: the `typescript` pin recorded by the skeleton (`~6.0.3`, since `vue-tsc` crashes on TS 7) was overridden by registry resolution to `^7.0.2` — pins were only read from overlays, and the native-plus-browser group has no overlay directory. The skeleton adds a `package.patch.json` declaring its own pins; each overlay pins its own, and the union takes effect. Also fixed "only the last layer's pinned dependency survives": the shell layer, ordered after the framework layer, wiped out the earlier pins wholesale.
- **Package manager follows the caller**: the install command and the subsequent three-step hints no longer hard-code pnpm; they give the corresponding command per the initiator (npm, pnpm, yarn, bun), falling back to npm when unrecognized.
- **Desktop shell stacked with framework layers**: the desktop shell originally carried its own composition root, valid only for the "native plus browser" group; stacked with Vue 3 or React the entry mismatched — Vue threw on startup, React silently degraded to a WebView with no bridge. Bridge assembly sinks into the skeleton, and the three composition roots uniformly pass ports; `@tauri-apps/api` sinks from the shell layer to the skeleton, leaving only `@tauri-apps/cli` in the shell layer.

## v0.3.3

2026-11-03 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.3)

### Added

- **Overlays can use `create.unset` to remove manifest keys**: the outer level is the manifest field name, the inner level the key names to remove, taking effect after merging and before wiping the `create` field.

### Improved

- **Story source belongs to the skeleton**: the default story source is ts, and the default project must run out of the box, so the whole TS authoring chain (`src/Stories.src/`, the type surface, `tsconfig.stories.json`, the three `stories:*` scripts, and the editor dependency) sinks into the skeleton, no longer supplied by overlays. The story-file form thus becomes a true overlay. Also fixed the old ts layer hard-coding the project-manifest `id` — now the id follows the project name. Template version 1.8.2 raised to 1.9.0.

### Other changes

- **README**: the number of publicly released packages changes from six to seven (adding `@lingfan-engine/create`); the `apps/` tree adds a mini-program row.

## v0.3.2

2026-11-03 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.2)

### Improved

- **Host plugin compatible with two vite generations**: the template serves the browser shell, desktop shell (vite 8), and mini-program shell (whose plugin pins vite to 5.2.8) at once. When `configureServer` and `invalidateModule` are written as function properties, strict function-type checking fails by parameter contravariance and consumer type checking errors; changing to method signatures is treated bivariantly, so both vite versions accept them.
- **Host-plugin type interlock**: a type test case added, requiring the host plugin to be accepted by both vite 5 and vite 8. Overlays do not enter the template project's type checking, so this blind spot could only be hit by consumers.
- **Release notes recognize Chinese commit types**: after commit types changed from `feat` / `fix` to `新增` / `修复` / `重构`, the generator only registered English, and Chinese titles fell wholesale into "Other changes." Both forms are now treated equally; `docs` / `chore` / `ci` and `文档` / `变更` / `模板` are explicitly classified into "Other changes."

### Fixed

- **React composition root read nodes too early**: `createRoot().render()` is concurrent rendering, only guaranteeing a later commit; reading the node handle immediately after reads an empty container, throwing on node access and leaving a white screen. Now it forces the first screen to land synchronously before reading; `UiHost`'s outer wrapper changes from `null` to `Fragment` — the former is not a legal calling form.

### Other changes

- **Template version**: raised to 1.8.2, minimum engine version aligned to 0.3.2 (`^0.3.1` also installs 0.3.2, but offline generation falls back to the value recorded by the template).

## v0.3.1

2026-11-03 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.1)

### Improved

- **Template type-surface interlock**: a test case added, scanning the two files in the template executed directly by Node, requiring that the runtime landing point resolved from the engine's value imports (`import type` does not count) is not TS source and actually ships with the package.

### Fixed

- **Build-config loading**: packages export TS source, but build config is loaded directly by Node. If the engine's runtime landing point in the config is `.ts`, the installed project crashes at config loading, while inside the repository the workspace link hides this. The `host-plugins` subpath adds a shipped `.mjs` shim that loads the real implementation with its own dependencies; exports change to conditional exports, with types pointing back to source.
- **Local plugin references**: when build config references a local plugin, the `.ts` extension is added, removing vite's `configLoader: 'native'` warning — `native` is the default loader in the next major version, at which point extensionless relative imports would fail outright.

### Other changes

- **Template version**: raised to 1.8.1. The template content changed; the engine version did not move.

## v0.3.0

2026-11-03 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.3.0)

### Added

- **Generator: engine-version validation**: `minEngineVersion` was previously just a decorative field; the template was written against an unreleased engine and only blew up at the user's first `pnpm dev`, and elsewhere at that. Now it is compared against the registry's actual version at generation time, failing directly if not met and explaining which package is short and by how much; the check is placed before writing to disk.
- **Template: saves with thumbnails**: WebView has no cross-end screenshot API, so the thumbnail is a composite card — stage background color, project name, speaker, current body text, timestamp. Size, quality, and whether to include text are decided by `shell.saves.thumbnail`; composite failure degrades to a save with no image.
- **Template: history panel and rollback**: a host-side history panel added; block aggregation goes through the engine (the host does not write its own, otherwise the rows shown in the panel and the rollback landing point would drift); the host only draws blocks, and a click translates to rolling back to the checkpoint at that block's tail. The `#history` slot is optional, same criterion as the preferences panel.
- **Template: saves can be named**: a save-name input added at the top of the slot panel; clicking a slot saves. If filled, use what was filled; if not filled but the slot already has a name, keep it; only when neither exists is one auto-generated. The host control surface's save interface adds optional-parameter passthrough.
- **Template: start page picks a save**: the third button on the start page expands a per-slot list (thumbnail, title, time); empty slots are listed but greyed out; slot data and "Continue" share the same refresh.
- **Example: enter straight to the start page**: the example now enters the start page first to choose start or continue; during play, Esc or clicking the mount panel brings up the pause menu; two host pages added — start page and pause page — and the composition root no longer auto-starts.
- **Engine: global pause and resume**: the engine adds `pause()` / `resume()` / `paused()`; the audio port adds `pause` / `resume`, audio state goes from two states to three, and two commands — pause and resume — are added. The paused state does not enter snapshots and does not interrupt external takeover; during pause, advancing and choosing are explicitly rejected, while navigation and save/load work as usual.
- **Engine: audio instance dimension and three-level volume resolution**: audio expands from "one sound per channel" to "multiple instances per channel"; start/stop and volume adjustment can name an instance, and four commands added — stop sound effect, play by instance, stop by instance, adjust volume by instance. Volume resolves at three levels: instance value, channel value, project default; the project manifest can declare default volumes. Audio config goes through the runtime context and does not change with saves, snapshots, or rollback.
- **UI: mount table and `mount` command**: column artifacts gain a `uis` field; `mount(handle | name, visible, props)` is a built-in command, props replaced wholesale, illegal fields and non-serializable values fail-closed; the system key `__mounts` is bidirectional; the skeleton adds a `#mounts` layer, where UI can cover the dialogue layer but not transitions or the error bar. Three host wirings: give container and table, give only a callback, give neither. Artifacts export interface handles by name, so story source can import directly.
- **UI: interface columns can mount full-screen pages**: interfaces needing real layout, like title pages and settings pages, are no longer piled up command by command. The page registry only handles registration and lookup; the mounter handles creation, mounting, and destruction on switch-away. The template ships a title-page example; without registering pages everything works as before.
- **Engine: column-list summary**: the read-only column list gives a three-item summary of id, type, and kind, without commands or entry content; the reader interface adds two optional methods for the current column id and type.
- **Contract: state-key read/write direction**: each state key is marked read-only, write-only, or bidirectional, placed in the contract layer as a declaration for the presentation layer to judge whether a control should be editable.
- **UI: element value write-back to state**: control value changes can write back to state, with landing points only recognizing audio channel volume or system keys; distinguishing "value is changing" from "value is settled" — not writing while sliding, only on release; without a write-back callback the control still operates normally, just the value does not land.

### Improved

- **Generator: template-snapshot incremental sync**: on Windows a process holding a directory handle cannot delete it; previously the snapshot directory was deleted then rebuilt, and packing on a dev machine sometimes reported permission errors. Now it syncs by manifest: first delete "had last time, not this time," then overwrite one by one.
- **Generator: default authoring form becomes TS story source**: the three forms are three ways of writing the same architecture; TS compiles to JSON in the same location with stronger capability, so the default switches to ts. Build-time dependencies are declared once in the skeleton, avoiding a missed version-number change in one of two places. A zero-change form can have no overlay directory.
- **Template: manifest scanning collected into `stories-build`**: the story manifest is a projection of disk facts and should not be hand-copied by the author — a missed copy only surfaces at runtime as "unknown column." The scanning implementation belongs to the build package; the template only declares where the resource root is; during development it watches the directory, and adding/removing files invalidates the module and refreshes the whole page.
- **Refactor: story source moves into `src/`**: story source moves from `Stories.src/` to `src/Stories.src/`, artifacts to `src/gen/`, so the host can import them as ordinary modules.
- **Refactor: story source can import UI**: UI specifiers go through a separate channel (`.vue`, `.tsx`, `.html`; `.ts` only when under `ui/`); the `ui/` directory name is the UI name, and the registry is auto-generated; cross-layer imports get static validation. The command line accepts `--sources-dir` / `--resources-dir`, and reads the project `tsconfig`'s `paths` to support arbitrary aliases.
- **Refactor: runtime-layer loose files re-homed by responsibility family**: top-level loose files move into subdirectories by responsibility; the export surface and package export paths are unchanged.
- **Refactor: path comparator kept in one place**: two byte-identical code-unit-order comparators merge into a shared module.
- **Refactor: template root directory re-homed**: the skeleton root keeps only the single entry and type declarations; everything else goes to its directory; the flat-layout check's scan surface covers the template.
- **Engine: scene type collapsed to two values**: scene type keeps only "game" and "interface" — menus, settings, overlays, and popups are the same thing; default or illegal values all fall to game, and the editor option merges into "interface."

### Fixed

- **Save high-water mark recorded per slot**: the demo save port previously recorded one global count; after saving slot 2, slot 1 was judged "older than the high-water mark," reading it was rejected, and the slot list lost names and previews. Now each slot records its own high-water mark; the mini-program and desktop native ports change in sync, and the native port additionally moves the high-water-mark file into a separate directory.
- **Column-level scope follows the save**: loading a save replays from before the column-level `let` declarations; the declarations do not re-run and the scope is empty, so `{a}` on stage displays as-is accompanied by undefined-variable. Saves now carry a column-level layer, and loading rebuilds the execution frame from it; each historical checkpoint in the save carries its own.
- **History and preferences panels covered up**: the layer table's default layer list missed these two layers, so the panels' z-index stayed at auto and they were covered by the dialogue and option layers — the panels opened but were invisible.
- **Clicking the stage during a menu wait hung a persistent error bar**: stage clicks were unconditionally mapped to advance; the engine only allows it in the dialogue, wait, and video states, fail-closing otherwise and writing the error into the interface, with no one clearing the error bar. Now it checks the wait state before advancing, and still completes the typewriter first if unfinished.
- **Example story's first screen reported a parse error**: the template story's line "media goes in `Resources/{Audio,Images,Video}`" was treated as an expression by the interpolator, erroring every time it played with a persistent error bar. The copy is changed to write the three directory names separately.
- **Framework-layer type declarations**: the Vue and React layers' `src/vite-env.d.ts` overwrote the skeleton's same-named file wholesale, declaring only font modules and missing the story-manifest module, so after generating a project the story-manifest access reported module-not-found and type checking was necessarily red (it still ran in dev, hard to notice).
- **Release script**: when the push output went outside the pipe, an empty value was retrieved and the cleanup handling threw directly, reporting a successful push as a failure.

### Other changes

- **Template: desktop-shell dependencies and entry**: the history-panel block aggregation lives in the shell package; the host does not write its own aggregation rules; the skeleton and root devDependencies declare in sync.
- **Repository checks**: single-file line counts into machine checking; the example-project directory is out of the scan surface; the host layer does not hard-code column names or project names; the template and engine export surfaces interlock — when the engine adds/removes exports, a mismatch in the template's named imports goes red on the spot, otherwise it would only be found when generating a project and running type checking.
- **Docs site**: this page goes live; a "packaging and encrypted release" guide added; the pages article rewritten to the engine's real boundaries; the UI-mounting and start-interface articles rewritten; save scope documented; site colors collected back into the token table; the scaffold docs' version criterion and default authoring form aligned with the implementation.

## v0.2.0

2026-10-26 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.2.0)

### Added

- **Story-source form**: the generator asks one more thing — write the story as `.story` files, or as TypeScript. Choosing the latter gives `src/Stories.src/`, the three scripts `stories:build` / `stories:watch` / `stories-typecheck`, a separate `tsconfig.stories.json`, and an out-of-the-box artifact, so after install you can `pnpm dev` directly. See [TS authoring mode](/advanced/ts-story-source/).
- **Overlays can delete skeleton files**: the layer-root `package.patch.json` supports `create.remove`, listing the paths (files or directory prefixes) that layer wants deleted. Merging deletes first, then writes. The mini-program shell can thus actually delete the skeleton's browser host and page stylesheet, rather than pretending they do not exist via `tsconfig` exclusion.
- **Input candidate shortcut values**: `input` adds an optional `options`, shaped `{ text, value }[]`. `text` is the wording on the candidate button and enters the translation table; `value` is the value written as-is into `store` when clicked, and does **not** enter the translation table — otherwise under multilingual the variables read by story logic would drift with language. The text format, the TypeScript vocabulary layer (`inputCandidate`), runtime state, the state read surface (`StateReader.inputCandidates()`), and the choice-layer interface are all wired through. See [menus, input, and notifications](/guides/menu-input/).
- **iOS screen orientation**: changed to pure Rust calling UIKit directly; no more Swift in the repository. At runtime the view controller hosting the page is swapped to a dynamic subclass overriding the two orientation-related selectors; sustained locking relies on reporting the current allowed set on every query.
- **Plaintext resources inside the shell**: the custom protocol adds a `raw/{path}` segment, supplying audio/video, images, fonts, and text directly by logical path. In the shell form the page loads from the packed artifact while resources land in another directory, so page-source-root-relative paths cannot fetch bytes — now the `resource_url(path)` command gives the single address, and the front end does not join paths.
- **One-command release**: `pnpm release --bump patch|minor|major` changes the eight manifests, runs the gates, commits, creates an annotated tag, and pushes to remote; after the tag is pushed, a workflow completes packing and release. See [releasing a new version](/guides/release/).

### Improved

- **Front-end loading inside the shell**: the host bridge is now injected by the composition root, no longer relying on a dynamic import of a variable specifier. Previously the page inside the shell failed to load wholesale, leaving only a white screen.
- **Pre-release versions**: forms like `0.2.0-rc.1` can be used directly; on release the dist-tag is taken from the first suffix segment (`rc` / `alpha` / `beta`), and installing with `@rc` works.

### Fixed

- **iOS target compilation**: the orientation-dispatch call site aligned with the platform implementation's return value; the iOS target compiles again.
- **Media error copy**: names specifically which resource could not be fetched, rather than a generic load failure.
- **Release script**: the tag-triggered pipeline no longer fails at the gate stage — when checking out a tag HEAD is detached, and a dry run should not be blocked by "must be on main."

## v0.1.5

2026-10-23 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.1.5)

### Fixed

- **Bridge-domain specifier**: the Tauri bridge domain changes to a non-constant specifier, so the browser and mini-program forms no longer fail to build because of it.

## v0.1.4

2026-10-23 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.1.4)

### Added

- **Project generator**: `@lingfan-engine/create`; `npm create @lingfan-engine my-story` generates a project from the template skeleton, replacing "copy the directory + hand-replace placeholders." See [creating a project from the template](/from-template/).
- **Framework overlays**: two layers, Vue 3 and React. The engine and adapters recognize no framework; swapping frameworks only swaps the page structure and entry.
- **Shell layers**: two layers, mini-program (UniApp) and desktop (Tauri 2). The skeleton also opens a port-override surface, through which the host takes over rendering and platform capabilities.
- **Layer declarations**: the template declares optional layers with `template-meta.json`; adding a layer only requires creating a same-named directory and adding an entry — the generator itself needs no change.

### Fixed

- **Desktop shell**: app icon and slot-name validation completed; icon files are no longer rewritten as text.

## v0.1.3

2026-10-22 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.1.3)

### Added

- **Release notes**: the body adopts the "Added / Improved / Fixed / Other changes" sections from commit messages, and attaches a full change link between this version and the previous tag. Only commits written in sections enter the notes; one-liners keep only that line.

### Improved

- **Release re-runnable**: already-published versions are skipped automatically; re-running after a mid-way failure does not re-publish.

### Fixed

- **Publish only on tags**: pushing packages and creating Releases both execute only on tag triggers; manual triggers can no longer push packages.

## v0.1.2

2026-10-22 · [Full description and commit list](https://github.com/MoFeng-02/LingFan.Engine/releases/tag/v0.1.2)

### Added

- **Pre-release self-check**: run a build-and-pack self-check before release; artifacts are verified before shipping.
- **Version-consistency check**: the repository root and each package's version number must be the same number, and the tag must match too.
- **Tag-driven automatic release**: after pushing a `v*` tag, a workflow completes packing, release, and creating the Release.

### Improved

- **Author-side toolchain**: the editor and compile packages become publishable packages, so external projects can install them directly.

---

The earlier `0.1.0` and `0.1.1` were published to npm, but no tags were created at the time; their changes are included in the history before v0.1.2.
