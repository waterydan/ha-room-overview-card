# Room Overview + Control Card

A reusable Home Assistant dashboard card with a room background, room icon, temperature and humidity, compact sensor indicators, and up to four control tiles in a single bottom row. Select a room in the visual editor; the card discovers its devices automatically. Each of the four tile dropdowns selects one group of controls, or None. Tapping anywhere on the overview, or holding it for 550 ms, opens the integrated Room Control Card. Both cards and their editors ship in one JavaScript module.

No separate launcher, Bubble Card, or Room Control package is required for room controls. Rooms and devices come from the user's Home Assistant Areas. No predefined rooms, dashboard configurations or room images are bundled. Examples and tests use placeholders and simulated devices.

## Install through HACS

1. Open HACS, select the three-dot menu, then **Custom repositories**.
2. Enter the URL of the public `room-overview-card` GitHub repository and select **Dashboard**.
3. Add the repository, find **Room Overview Card**, and download it.
4. Reload the browser. Add **Room Overview Card** to a dashboard and select a room in its visual editor.

HACS normally registers the JavaScript module for storage-mode dashboards. If resources are managed in YAML, add `/hacsfiles/ha-room-overview-card/room-overview-card.js` with `type: module` to your dashboard resources. Installation through a published HACS repository has not yet been verified.

## Install manually

1. Download the repository's source ZIP, or extract a locally generated manual-install ZIP. Copy `dist/room-overview-card.js` into `/config/www/room-overview-card/`.
2. In dashboard Resources, add `/local/room-overview-card/room-overview-card.js?v=1.3.1` as a JavaScript module.
3. Reload the browser. Add **Room Overview Card**, then select a room.

For YAML dashboards, register the same URL under `lovelace.resources` with `type: module`.

```yaml
type: custom:room-overview-card
area: your_area_id
```

The `area` value is the Area ID, not its display name. The visual editor fills this in for you.

## Card modes

Choose **Full** or **Simple** in the visual editor's **Card mode** dropdown. Existing cards default to Full and retain their room background, readings, sensor indicators and four control tiles.

**Simple** turns one mini control tile into the entire card, with no wallpaper, readings or extra tiles. Choose its **Device group** in the editor. The icon, active highlight and unavailable marker follow that group. Tapping anywhere on the tile opens all room controls, using the same independent control exclusions as Full mode. The room and group are included in its tooltip and accessible label.

```yaml
type: custom:room-overview-card
area: your_area_id
mode: simple
group: lights
show_room_title: true
show_state: true
```

Supported `group` values are `lights` (the default), `fans`, `covers`, `switches`, `climate`, `media`, `locks`, `contacts` and `occupancy`. Contacts and occupancy show sensor status. Device and entity exclusions apply to the selected group. Empty groups keep their icon; tapping still opens the room controls. They never switch to another overview group. Full-mode choices remain saved when switching modes.

**Show room title** (`show_room_title`) and **Show device status** (`show_state`) are independent toggles, both off by default. Lights, fans and switches show counts such as `2 on`. Speakers show the current track and artist during playback, identify paused/buffering playback, and show Idle or Off without stale track metadata. Covers and contacts show how many are open; locks show how many are unlocked.

Switch status includes wattage when power sensors are available, for example `3 on (48 W)`. Automatic detection uses one unambiguous power sensor on each selected switch device. Overlapping meters and partially selected multi-channel switches require explicit choices in **Advanced → Power sensors** (`power_sensors`). Values in W, kW, MW or mW are converted to watts. Partial readings are labelled `measured`; missing readings never become a false zero. An empty `power_sensors: []` hides wattage. Device and entity exclusions apply to power readings too.

### Resizing

Use Home Assistant's **Layout** tab to choose the card's columns and rows. Both modes fill the assigned grid space, including rectangular layouts. No pixel-size settings are needed; old `simple_size` and `full_height` values are ignored and removed when editing the card. With **Auto height** enabled, Simple cards are square and Full cards keep their original room layout. Width follows the dashboard layout on smaller screens.

The Simple icon scales with the smaller card dimension: 50% for an icon-only card, or 35% when the room title or device status is shown. Resizing the card or narrowing the dashboard automatically resizes the icon. Compact cards use one line per text label to preserve space. Long titles or tracks are truncated, with the full status in the tooltip.

For example, a Simple card can use 3 columns and 2 rows:

```yaml
type: custom:room-overview-card
area: your_area_id
mode: simple
group: lights
grid_options:
  columns: 3
  rows: 2
```

Run `npm run build:demo` to generate `dist/room-overview-card-demo.js`, an isolated clone with the card type `custom:room-overview-card-demo` and its own visual editor. Register this module alongside the installed card to preview both modes. It is generated from the same source and does not replace the installed component.

## Room setup

Use Home Assistant's Areas to assign devices, set the room icon and picture, and select temperature and humidity sensors. The card uses those values. An entity's explicit area assignment takes precedence over its device's area. Disabled, hidden, configuration and diagnostic entities are omitted.

Background priority is the card's image override, then the Area picture. When neither is set, or an image cannot be loaded, the card uses the theme's card surface and text colors. There are no bundled backgrounds or predefined room types.

**Room icon override** and **Background image override** are in the main editor, directly below Room. The icon dropdown searches Home Assistant's full icon catalog, including custom icon sets that provide a catalog. The image picker opens Home Assistant's Media browser, filtered to images. Choose **My media** and browse your Media folders; images must be available in Home Assistant's Media browser. You can also enter a `/local/` image path or HTTPS URL. Clear the icon selection or choose **Use room background** to restore the room defaults.

Media selections are saved as stable `media-source://` IDs in `image`. The card resolves and refreshes the authenticated image URL when displaying it; temporary signed URLs are never saved in the card configuration. Existing image URL and icon overrides continue to work.

## Sensor indicators and control tiles

Contacts and motion / presence appear beside the temperature and humidity warning icons. Motion / presence indicators appear while any sensor detects motion or presence and hide when all sensors are inactive. Contact indicators appear when any contact is open and hide when all contacts are closed. Unavailable members keep an indicator with an exclamation marker. The indicators use the same small rounded boxes, with subdued pink tones when active. Visible boxes pack together with 4 px spacing; hidden or missing indicators leave no empty slots. Tapping a sensor box opens the room controls, where the sensor badges expand to individual readings. Sensor indicators are independent of the four control choices. Control settings determine whether hidden entities appear in the room controls.

The editor provides **Tile 1, Tile 2, Tile 3 and Tile 4**. Each chooses an available control group in that room. A group can be used once. All visible control tiles sit in one row at the bottom. **Mini tile alignment** aligns the row Left, Center or Right; Right is the default. Choose None to omit a tile. Missing groups leave no blank spaces in the row, while their saved choices remain available for later room changes.

Available control groups are Lights, Fans, Covers, Switches, Climate, Media players and Locks. Automatic mode fills the first four populated control groups in that order. Changing a dropdown saves the four choices; **Use automatic mini tiles** restores discovery. Group members always follow current room assignments. Older saved Contacts or Motion / presence tile choices move to the sensor row automatically without changing individual card configurations.

Tapping a mini tile, reading, indicator, room name or card background opens the same room controls. Keyboard activation and a 550 ms hold work too; movement, scrolling, cancellation and leaving the page cancel a pending hold. Sensor badges expand into individual readings. Controls include lights, switches, climate, fans, media players, covers, numbers, selects, scenes and scripts. Cameras use native picture-entity cards, with carousel buttons or separate cards. Advanced actions open Home Assistant's native More info dialog.

The room popup fits desktop, tablet and phone widths, with an 840 px preferred desktop width and Home Assistant’s native responsive dialog behavior. It keeps the room title beside its close button. Escape first closes expanded sensor readings, then the room. Closing returns focus to the opener and unmounts the controls, releasing native camera components and registry listeners. Unrelated updates preserve mounted controls; relevant updates retain the popup's scroll position.
Active control groups highlight yellow; active sensor groups use subdued pink. Any unavailable member adds an exclamation marker, so a partly unavailable group is not shown as fully off. Native HA groups are omitted when their individual members are already present. Switch-as-light source switches are omitted when the converted entity is in the room. Ordinary switches remain in Switches; use Advanced to explicitly include lighting switches in Lights.

```yaml
type: custom:room-overview-card
area: your_area_id
tiles: [lights, fans, covers, none]
tile_alignment: right
```

## Native room controls

The popup uses native Home Assistant components throughout: compact entity rows for lights, power and actions; feature tiles for climate, fans, media and covers; picture-entity camera cards; native badges, expansion panels and dialogs. Both editors use native selectors and forms. Home Assistant supplies control behavior, accessibility, themes and More info. No control components are copied into the package.

The same discovery and presentation rules apply to every room. Technical dotted names are shortened for display without renaming entities. Daily controls are grouped by function. Current physical readings appear at the top; event timestamps, healthy batteries, camera counters, secondary device settings and unclassified entities remain available under **More room details**. Ordinary user-authored names are preserved. Native tile layout remains available, and saved `grouped` configurations are accepted as compact rows.

## Independent exclusions

The visual editor has two separate sections: **Overview exclusions** and **Control exclusions**. Each offers Home Assistant’s searchable, multi-select device and entity pickers. Overview exclusions change only the overview's tiles, indicators, counts and readings. Control exclusions change only the popup's controls, badges and cameras. Either section can be empty; neither inherits the other.

Excluding a device hides all of its entities, including new entities added later. Entity exclusions hide only the selected entity. Linked switch aliases and aggregate entities cannot bypass either list. Saved missing devices/entities stay manageable in the editor. Selecting another room resets both lists.

```yaml
type: custom:room-overview-card
area: your_area_id
overview_exclusions:
  devices:
    - your_device_registry_id
  entities:
    - sensor.overview_only_exclusion
control_exclusions:
  devices: []
  entities:
    - switch.controls_only_exclusion
control_options:
  layout: tiles
  camera_layout: carousel
  include_hidden: false
  include_diagnostics: false
```

`devices` contains Home Assistant device registry IDs, which the editor selects for you. `entities` contains entity IDs. Legacy top-level `exclude_devices` and `exclude_entities` remain accepted for the overview only; saving in the editor moves them into `overview_exclusions`. Control exclusions default to empty. Existing paired launcher/control configurations are migrated with each side's original exclusions, without linking the two lists.

When migrating an existing installation, replace its separate overview, control and launcher resources with the combined module after updating the paired room configurations. Keep any standalone `custom:room-control-card` cards; this bundle supplies their class too. Reload the frontend so previously registered JavaScript classes are replaced. The workspace migration helper converts paired exports while preserving each side's exclusions.

## Room controls

`control_options` accepts `layout` (`compact`, `tiles` or the legacy `grouped` alias), `camera_layout` (`carousel` or `tiles`), `include_hidden`, `include_diagnostics`, `everyday_controls`, `always_show`, and an optional explicit `entities` list. The integrated defaults are compact rows, camera carousel, and hidden/diagnostic entities omitted. An explicit list replaces area discovery for controls only. Automatic purpose filters and manual exclusions also apply to that list. [Control behavior and CCTV details](docs/controls.md) describe the supported actions.

### Everyday controls

**Everyday controls** is enabled by default. It automatically hides device configuration, Identify buttons (including those with an Identify device class), update/firmware entities and automation entities. Diagnostic details are hidden by default too. Battery percentages remain available even when marked Diagnostic. Healthy batteries appear under More room details; low or unavailable batteries also add a status badge. Lights, regular switches, climate, fans, covers, media players, cameras, normal room sensors, scenes and scripts keep their usual behavior.

The rules apply as new entities are discovered. They change only what the card displays; automations keep running and no entity is disabled in Home Assistant. Turn off Everyday controls to make setup/update/automation entities available in More room details. **Include diagnostic entities in controls** separately exposes diagnostic details.

Open **Always show** in the visual editor and search for room entities that should override the automatic filters. The YAML equivalent is `control_options.always_show`. This override never bypasses manual entity/device exclusions, changes area membership, or enables a disabled entity. Hidden entities still respect Include hidden entities. Always show also promotes a secondary entity from More room details into the primary controls.

```yaml
control_options:
  everyday_controls: true
  include_diagnostics: false
  always_show:
    - automation.example_room_action
```

For a standalone `custom:room-control-card`, use `everyday_controls` and `always_show` at the top level of its card configuration. The overview continues to use its separate overview exclusions.

The bundle also registers `custom:room-control-card` for standalone detailed controls. It uses its own existing `exclude_devices`/`exclude_entities` settings when configured directly. Install the overview bundle once to use either card type.

## Readings and warnings

The Area's selected temperature/humidity sensor is preferred. Without a preferred sensor, the card shows the median of the room's valid sensors of that type. Advanced lets you choose a specific sensor or None. If an Area-selected or overridden sensor is excluded, the card uses the remaining eligible room sensors; the editor explains the fallback. With none remaining, the card shows a dash. Unavailable readings show a dash and never trigger warnings.

The four warning icons appear above/below these defaults:

| Warning          | Default               |
| ---------------- | --------------------- |
| Low temperature  | Below 12 °C / 53.6 °F |
| High temperature | Above 30 °C / 86 °F   |
| Low humidity     | Below 30%             |
| High humidity    | Above 75%             |

Change each threshold in Advanced, or leave it blank to disable that warning. Temperature uses the Home Assistant unit system unless overridden, with Celsius/Fahrenheit sensor conversion. Explicit temperature thresholds use the displayed unit; switching units in the editor converts them. Thresholds are comfort indicators and can be tailored to each room.

```yaml
type: custom:room-overview-card
area: your_area_id
tiles: [lights, fans, switches, none]
temperature_sensor: sensor.example_temperature
humidity_sensor: sensor.example_humidity
thresholds:
  temperature_low: 12
  temperature_high: 30
  humidity_low: null
  humidity_high: 75
```

Optional YAML settings: `name`, `icon`, `image`, `image_position` (CSS object-position), `tile_alignment` (`left`, `center`, `right`), `temperature_unit` (`auto`, `°C`, `°F`), `light_switches` (entity ID list), `overview_exclusions` and `control_exclusions` (independent device/entity lists), `control_options` (popup settings). Sensor settings also accept `none`. Only `area` is required.

## Share through HACS

Publish this repository as a public GitHub repository named `room-overview-card`, with a description, issues enabled, and topics such as `home-assistant`, `lovelace`, `custom-card` and `hacs`. Commit `dist/room-overview-card.js` alongside the root `README.md`, `LICENSE` and `hacs.json`. This layout follows the [HACS dashboard repository requirements](https://www.hacs.dev/docs/publish/plugin/).

The default branch is sufficient for a HACS custom repository; GitHub releases are optional. Initially, use the committed `dist/` module without publishing release assets. If adding versioned releases later, create a GitHub release from a commit containing the built module and verify HACS installs that version. The ZIP produced by `npm run package` is for manual installation; do not upload it as a HACS release asset.

Only this standalone repository should be published. Do not import a private Home Assistant workspace's Git history, dashboards, entity/device snapshots, connection settings or room images. Every YAML example uses placeholder IDs that must be replaced with IDs from the installer's own system.


## Development and packaging

Node.js 20+ and Python 3 are required for packaging. Browser tests use Playwright.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run package
```

`npm run build:inline` produces compact primary and isolated demo modules for Home Assistant inline resources, using the pinned Terser development dependency. `npm run build` generates the one installable `dist/room-overview-card.js`. `npm run build:demo` also generates an isolated preview with separate overview and control element names, so installed cards cannot override its classes. `npm run package` creates `releases/room-overview-card-1.3.2.zip`, containing the combined bundle, documentation, license and HACS metadata. Commit the built bundle with the source.

`npm run test:browser` loads real native components from Home Assistant’s public demo, then supplies simulated states and API contexts. It checks native entity actions, badges, exclusions, editor selectors, keyboard/hold activation, dialog lifecycle, camera navigation and phone/tablet/desktop layouts in light and dark themes. Device actions stay within the test fixture. Static frontend assets require network access. Set `BROWSER_CHANNEL=chrome` for installed Chrome and `PLAYWRIGHT_MODULE` for a bundled Playwright path.

The old standalone HTML demo and component stand-ins were removed. Preview in a Home Assistant dashboard using the isolated `custom:room-overview-card-demo` bundle. For a private local all-room audit, `ROOM_NATIVE_DATA` can point to a JSON fixture with `areas`, `devices`, `entities`, `states`, and `cards`; never publish private registry snapshots.

## License

MIT. Both projects' copyright notices are retained in LICENSE and the distributed module.
