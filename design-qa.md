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

## Local GM update — 0.15.0-local.2

Date: 2026-09-21. Evidence: `work/agent-os-gm-2026-09-21/evidence/` relative to the workspace. Tested in the isolated Foundry 12.331 world, not a working campaign.

- NPC payout without a source sheet credited 250 to a test player's character (50 → 300) while the selected test source stayed at 1000. An explicit-source payment of 125 then produced balances 875 / 425. Both recipient ledger entries identify the NPC name, number and purpose. The NPC wallet lists both payments. Evidence: `native-payments.json` and `wallet-wide.png` / `wallet-narrow.png`.
- An attempted payment of 2000 from the 875 source displayed an inline insufficient-funds error, retained the form, and changed neither balance nor payment receipts. The successful payments survived reload. Evidence: `payment-validation.png`, `native-after-validation.json`.
- From an unrelated NPC device, the GM saw a player-to-player call, participants, replies, initiator, time and status. All/current-device scopes, active filter and number search worked. The GM ended that call without joining or changing members. The GM-panel shortcut opened the complete call history. Evidence: `calls-wide.png`, `calls-narrow.png`, `native-calls-ended.json`.
- The existing custom map survived upgrade. “Карта 2045” loaded the supplied PNG at its original 3066 × 2408 resolution. Existing place data remained accessible; 150% zoom and reset worked. The zoom control now displays the current scale. Evidence: `map-wide.png`, `map-narrow.png`.
- The three screens were checked at application widths 1100 and 550 pixels. Narrow page width and scroll width were both 526 pixels; enlarged map scrolling is confined to its viewport. Navigation and primary actions remain usable.
- Full automated suite: **82 passed, 0 failed** (`tests-full.txt`). Includes authenticated GM-only payouts, concurrent retry protection, rejected altered receipts, no duplicate credit after a character change, invalid destinations and sums, failed-credit refund/retry, call visibility and permissions, and preservation of custom maps and legacy data.
- The test world's minimal module set reports a pre-existing missing `ru` core-language configuration and falls back to English Foundry chrome. Agent UI remains Russian; no new Agent browser error was observed (`console.json`). Native verification used one GM browser. Player authorization is covered by service/model tests rather than claimed as a simultaneous player session.

No live audio/video monitoring is added. Publication to GitHub is outside this local update.

## Release promotion — 0.15.0

The user subsequently requested publication to GitHub. Version 0.15.0 promotes the tested local builds above; publication changes the version, installation URL, changelog and documentation. Application behavior remains the same as 0.15.0-local.2. The historical local-only scope statements above describe the original verification runs. Release preparation reruns the automated suite and verifies the manifest, archive contents and public downloads. Evidence directory: `work/agent-os-release-2026-09-21/evidence/`.

## Map navigation — 0.15.1-local.1

Date: 2026-09-21. Local update only. Evidence: `work/agent-map-2026-09-21/evidence/`.

- Replaced width-only scaling with a fitted image viewport. Mouse dragging pans the map; wheel zoom is anchored at the cursor. Fit, zoom buttons and keyboard navigation are available. A stable scrollbar gutter prevents the map shifting as scrollbars appear.
- GM placement mode creates a new place at the clicked image coordinate, with its normal title/description/audience form. Existing pins can be dragged, or moved by selecting a destination. Players retain navigation and place selection; the authenticated GM is required for coordinate writes.
- Coordinate-only updates preserve descriptions, audience and linked jobs. Search and category filters operate on both markers and the place list. Selecting a list entry centers its marker. A resize or content refresh retains normalized view position; changing the map image resets to fit.
- Native Foundry 12.331: a click at 264% zoom filled coordinates 66.09 / 58.94, matching the clicked image location. Dragging by 45 × 30 pixels saved 71.52 / 63.55, matching the expected geometry. Destination-click movement saved 48.73 / 59.86; those coordinates survived page reload. The previous place remained at 40 / 55 with its title, description, audience and job link unchanged. Evidence: `pin-drag.json`, `persisted-map.json`.
- Cursor zoom stayed within one rendered pixel of the same image point. Content refresh retained scroll offsets exactly (116 / 203). Evidence: `zoom-refresh.json`.
- Verified search, list navigation, fit, keyboard Enter placement, form cancellation and Esc cancellation. Cancelling did not create another place. Layout checked at 1100 and 550 pixel application widths; the narrow page and scroll width were both 526 pixels. Evidence: `map-navigation-wide.png`, `map-navigation-narrow.png`, `map-fit-wide.png`.
- **89 automated tests passed**, including map geometry, GM permissions, failed-save rollback and preservation of existing mission data. Native checks used a GM client in an isolated test world; player permissions were checked through the model and authenticated service tests. No new browser error was observed in the final run.

Production worlds are not seeded or migrated. Existing percentage coordinates are used as-is. Full release publication is not part of this local map update.
