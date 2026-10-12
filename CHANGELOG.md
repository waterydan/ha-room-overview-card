# Changelog

## 1.3.1 — 2026-10-12

- Restore left-aligned room names and readings after the native button migration.
- Reduce the vertical gap between room names and climate readings by 4px.
- Size native button parts to keep motion and warning icons inside their badges.
- Check overview geometry against native Home Assistant components at narrow and desktop widths.

## 1.3.0 — 2026-10-12

- Apply shared compact room controls across all room types, with readable names and secondary information under More room details.
- Use native Home Assistant rows, feature tiles, picture cards, badges, expansion panels, dialogs, selectors and forms.
- Preserve independent overview/control exclusions and Always show promotion.
- Remove custom controls, camera image/signing code, duplicate sensor grouping and obsolete component stand-ins.
- Verify against real native components with simulated APIs and states.

## 1.2.0 — 2026-10-12

- Enable Everyday controls: hide setup, Identify buttons, firmware/update entities and automations automatically.
- Keep battery percentages when other diagnostics are hidden.
- Add searchable Always show overrides while preserving manual entity/device exclusions.
- Apply filtering to future discoveries and explicit lists without changing Home Assistant entities or automations.
- Provide reproducible compact deployment modules with pinned Terser tooling.

## 1.1.0 — 2026-10-12

- Merge Room Control into the overview bundle, with a shared registry pool and no separate launcher or popup dependency.
- Add independent `overview_exclusions` and `control_exclusions` device/entity lists and searchable visual editor sections.
- Open integrated room controls on tap, keyboard activation or hold, with responsive grids and camera viewing.
- Remove duplicate overview controls, obsolete light helpers and separate package wiring.
- Preserve overview appearance, simple summaries, sensor warnings and control behavior.

## Earlier local changes

- Add Full and Simple modes, retaining Full as the default for existing cards.
- Simple mode displays one selectable group icon and opens its individual device controls without loading wallpaper.
- Add mode-aware visual editor fields, compact grid sizing and an isolated demo build.
- Make both modes fill the columns and rows selected in the dashboard Layout tab, with square Simple cards when Auto height is enabled.
- Add independent room-title and device-status toggles, current media metadata and switch power summaries with sensor overrides.
- Scale Simple icons in proportion to the actual card size, reserving space for optional labels.
- Hide Full-mode motion / presence indicators while inactive, retaining unavailable warnings.

## 1.0.0 — 2026-10-06

- Initial standalone repository for installation as a HACS custom Dashboard repository.
- Discover rooms and supported devices from Home Assistant Areas.
- Configure four control tiles, device exclusions and sensor warnings in the visual editor.
- Use the installer's Area picture or image override, with theme colors when no image is available.
- Include no predefined rooms, dashboard exports or bundled room artwork.
- Build a single JavaScript module and an optional manual-install ZIP.
