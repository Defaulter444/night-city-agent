# Agent OS local design QA

Date: 2026-09-21. Target: Foundry VTT 12.331, Cyberpunk RED, module 0.15.0-local.1.

## Scope and reference

The user supplied ten portrait device mockups and requested as much of their functionality as practical in the existing local Agent module. This is an adaptive Foundry implementation, not a pixel-for-pixel reproduction of the illustrated phone casing. Existing campaign data and document permissions are retained. No GitHub publication is part of this task.

Reference set: `ChatGPT Image 21 сент. 2026 г.` in the user's Downloads, numbered (1)–(10): home, contacts, messages, call, map, wallet, jobs, files, Data Pool, settings. Reference images and native captures were inspected together. The city panorama is an original generated asset; the portrait used in the isolated test is a fixture and is not shipped.

Evidence directory relative to the workspace: `work/agent-os-2026-09-21/evidence/`. Captures are named `wide-<page>.png` and `narrow-<page>.png` for all ten pages. The browser viewport remained at its normal 1280×720. Native application widths tested were 1100 and 550 pixels; Foundry constrained height to the available viewport. Measurements are in `wide-layouts.json` and `narrow-layouts.json`.

## Visual comparison

| Surface | Preserved visual intent | Adaptation |
| --- | --- | --- |
| Home | City panorama, red clock, cyan labels, compact personal widgets | Responsive two-column desktop layout and scrollable content; real local/calendar time is labelled. |
| Contacts | Portraits, search, categories, favorites, direct actions | Existing numbers and books; individual notes and editable uploaded portraits; two columns become one. |
| Messages | Contact rail, portrait, incoming/outgoing bubbles, bottom composer | Existing messaging and attachments retained; readable portrait spacing corrected at narrow widths. |
| Files | Search/filter row, file list, separate preview and actions | Existing Agent documents, folders/tags personal to each device; journal notes have a separate filter. |
| Jobs and Data Pool | Status/reward cards, steps, colored accents, illustrated articles | Only GM-published material is delivered to intended players; forms use the existing Foundry dialogs. |
| Calls, map, wallet, settings | Recognizable dedicated screens and persistent navigation | Calls are scenic, maps are GM-supplied, balances use actual character sheets, equipment opens its sheets. |

Dark panels, restrained red/cyan highlights, consistent borders, existing Cyrillic-capable fonts and a persistent navigation bar connect the screens. Decorative battery percentages, arbitrary reputation/heat scores, fake microphone controls, bank balances and GPS values were not fabricated. The heavy painted hardware bezel and right-hand rail were omitted to preserve space in Foundry. These are intentional scope adaptations rather than unresolved rendering defects.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A large PNG portrait exceeded the profile budget after compression. | Uploaded OS images are encoded as WebP; the 2.2 MB test portrait saved and reloaded successfully. |
| P2 | A portrait overlapped contact text in the narrow messaging rail. | Corrected selector specificity and narrow portrait dimensions; rechecked with an active conversation. |
| P2 | Old stylesheet selectors overrode the clock and chat palette. | Scoped rules now win without changing the existing layout behavior. |
| P2 | A file saved from a news article remained hidden by the previous notes/folder filter. | Opening a newly created or attached document resets incompatible file filters; covered by regression test and native interaction. |
| P2 | Navigation could preserve scroll position from a different screen. | Reset scroll on section/device change, retain normal same-screen behavior. |
| P2 | Selecting call history could display an unrelated active call. | Explicitly selected call takes priority; regression test added. |
| P2 | Image preview buttons lacked an accessible name. | Added descriptive image-open labels. |

All ten navigation destinations were opened at both widths. Measured page/navigation widths showed no horizontal overflow. The navigation remains reachable, main panels scroll, dialogs preserve Save/Cancel, and empty states explain the next action. Inputs and icon-only actions have labels; active state is expressed by icon/text styling as well as color. This is a targeted design/accessibility check, not a formal WCAG certification.

## Functional evidence

- Native Foundry: contact number and note preserved; portrait upload; contact-to-thread navigation; job checkbox persisted; map zoom/filter; call start, accept, invite, decline and end; file create/edit/folder/tags/favorite; article bookmark and save-to-file; journal note create/open; compact setting; message draft survives navigation; reload retains data.
- Native visibility report: one selected player receives the assigned job, another does not; draft article stays with GM; private GM contact annotations are absent from player projection. Report: `native-state-report.json`.
- Automated suite: 73 tests pass, including OS model/service permissions, spoofed caller rejection, failed-write rollback, image validation, encrypted recovery, legacy-data preservation, existing messages/documents/conferences/wealth and wiring tests. Output: `tests-full.txt`.
- No new browser console errors observed in the final native run.
- Native interaction used a GM client switching test devices. Separate player authorization was verified by service/model tests and user projections, not claimed as a simultaneous multi-browser play session.

## Result

**PASS for the local adaptive implementation and the tested flows.** No unresolved P0/P1/P2 findings within this scope. Not all illustrated product concepts are implemented: live audio/video, automatic street routing, audio recording and full calendar integration remain separate work. The user-facing guide lists these boundaries. Working worlds are not seeded with demonstration content.
