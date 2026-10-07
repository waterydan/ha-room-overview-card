# Room Overview Card

A reusable Home Assistant dashboard card with a room background, room icon, temperature and humidity, compact sensor indicators, and up to four control tiles in a single bottom row. Select a room in the visual editor; the card discovers its devices automatically. Each of the four tile dropdowns selects one group of controls, or None.

No other custom card is required. Rooms and devices come from the user's Home Assistant Areas. No predefined rooms, dashboard configurations or room images are bundled. Examples and tests use placeholders and simulated devices.

## Install through HACS

1. Open HACS, select the three-dot menu, then **Custom repositories**.
2. Enter the URL of the public `room-overview-card` GitHub repository and select **Dashboard**.
3. Add the repository, find **Room Overview Card**, and download it.
4. Reload the browser. Add **Room Overview Card** to a dashboard and select a room in its visual editor.

HACS normally registers the JavaScript module for storage-mode dashboards. If resources are managed in YAML, add `/hacsfiles/room-overview-card/room-overview-card.js` with `type: module` to your dashboard resources. Installation through a published HACS repository has not yet been verified.

## Install manually

1. Download the repository's source ZIP, or extract a locally generated manual-install ZIP. Copy `dist/room-overview-card.js` into `/config/www/room-overview-card/`.
2. In dashboard Resources, add `/local/room-overview-card/room-overview-card.js?v=1.0.0` as a JavaScript module.
3. Reload the browser. Add **Room Overview Card**, then select a room.

For YAML dashboards, register the same URL under `lovelace.resources` with `type: module`.

```yaml
type: custom:room-overview-card
area: your_area_id
```

The `area` value is the Area ID, not its display name. The visual editor fills this in for you.

## Room setup

Use Home Assistant's Areas to assign devices, set the room icon and picture, and select temperature and humidity sensors. The card uses those values. An entity's explicit area assignment takes precedence over its device's area. Disabled, hidden, configuration and diagnostic entities are omitted.

Background priority is the card's image override, then the Area picture. When neither is set, or an image cannot be loaded, the card uses the theme's card surface and text colors. There are no bundled backgrounds or predefined room types.

**Room icon override** and **Background image override** are in the main editor, directly below Room. The icon dropdown searches Home Assistant's full icon catalog, including custom icon sets that provide a catalog. The image picker opens Home Assistant's Media browser, filtered to images. Choose **My media** and browse your Media folders; images must be available in Home Assistant's Media browser. You can also enter a `/local/` image path or HTTPS URL. Clear the icon selection or choose **Use room background** to restore the room defaults.

Media selections are saved as stable `media-source://` IDs in `image`. The card resolves and refreshes the authenticated image URL when displaying it; temporary signed URLs are never saved in the card configuration. Existing image URL and icon overrides continue to work.

## Sensor indicators and control tiles

Contacts and motion / presence appear beside the temperature and humidity warning icons. Motion / presence indicators stay visible and turn grey when inactive. Contact indicators appear when any contact is open and hide when all contacts are closed. Unavailable members keep an indicator with an exclamation marker. The indicators use the same small rounded boxes, with subdued pink tones when active. Visible boxes pack together with 4 px spacing; hidden or missing indicators leave no empty slots. Tapping a sensor box opens its group of sensors. Sensor indicators are independent of the four control choices. Tapping the room name also gives access to hidden contact sensors.

The editor provides **Tile 1, Tile 2, Tile 3 and Tile 4**. Each chooses an available control group in that room. A group can be used once. All visible control tiles sit in one row at the bottom. **Mini tile alignment** aligns the row Left, Center or Right; Right is the default. Choose None to omit a tile. Missing groups leave no blank spaces in the row, while their saved choices remain available for later room changes.

Available control groups are Lights, Fans, Covers, Switches, Climate, Media players and Locks. Automatic mode fills the first four populated control groups in that order. Changing a dropdown saves the four choices; **Use automatic mini tiles** restores discovery. Group members always follow current room assignments. Older saved Contacts or Motion / presence tile choices move to the sensor row automatically without changing individual card configurations.

Tapping a tile opens all members of that group. Lights use sliding on/off toggles, including lighting switches explicitly added to Lights. Dimmable lights also have a brightness gradient slider. Color-capable lights show a rainbow hue slider and omit white temperature, even when they also support it. Lights that support tunable white without color show a warm-to-cool temperature gradient. Controls follow each light's supported color modes, with compatibility for older light feature flags. Brightness ranges from 1–100%; use the separate toggle for power. Adjusting a slider turns the light on with the selected setting. Switches and fans have inline controls. Other devices open Home Assistant's native controls when their row is tapped. Tapping the room name opens every supported group, including groups beyond the four visible slots. The room icon appears beside the name; mini tiles use their group's icon.

Active control groups highlight yellow; active sensor groups use subdued pink. Any unavailable member adds an exclamation marker, so a partly unavailable group is not shown as fully off. Native HA groups are omitted when their individual members are already present. Switch-as-light source switches are omitted when the converted entity is in the room. Ordinary switches remain in Switches; use Advanced to explicitly include lighting switches in Lights.

```yaml
type: custom:room-overview-card
area: your_area_id
tiles: [lights, fans, covers, none]
tile_alignment: right
```

## Device exclusions

Open **Device exclusions** below Mini tile alignment. Search the selected room's devices and tick those to exclude. Each row shows the device's friendly name and the number and types of entities it contributes. Excluding a device excludes all its entities, including entities added later. The card preview immediately updates its tiles, counts, sensor indicators, readings, warnings and popup contents. Empty groups disappear.

Expand **Specific entities** to exclude only part of a device or a helper with no device. Search by friendly name or entity ID. Entities excluded with a device or through a linked entity remain checked and disabled; restore the device or the original entity exclusion to bring them back. Groups containing an excluded member and switch-as-light aliases cannot bypass exclusions.

Exclusions are saved per card. Other cards and automations are unaffected. Excluded items remain listed so they can be restored, including saved items that have moved or no longer exist. Changing the Room dropdown clears the exclusions along with other room-specific choices.

YAML accepts `exclude_devices` (device registry ID list) and `exclude_entities` (entity ID list). Existing `exclude_entities` settings continue to work. The visual editor fills device IDs for you; device names are not IDs.

```yaml
type: custom:room-overview-card
area: your_area_id
exclude_entities:
  - switch.example_helper
```

## Temperature, humidity and warnings

The Area's selected temperature/humidity sensor is preferred. Without a preferred sensor, the card shows the median of the room's valid sensors of that type. Advanced lets you choose a specific sensor or None. If an Area-selected or overridden sensor is excluded, the card uses the remaining eligible room sensors; the editor explains the fallback. With none remaining, the card shows a dash. Unavailable readings show a dash and never trigger warnings.

The four warning icons appear above/below these defaults:

| Warning | Default |
| --- | --- |
| Low temperature | Below 12 °C / 53.6 °F |
| High temperature | Above 30 °C / 86 °F |
| Low humidity | Below 30% |
| High humidity | Above 75% |

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

Optional YAML settings: `name`, `icon`, `image`, `image_position` (CSS object-position), `tile_alignment` (`left`, `center`, `right`), `temperature_unit` (`auto`, `°C`, `°F`), `light_switches` (entity ID list), `exclude_devices` (device registry ID list), `exclude_entities` (entity ID list). Sensor settings also accept `none`. Only `area` is required.

## Share through HACS

Publish this repository as a public GitHub repository named `room-overview-card`, with a description, issues enabled, and topics such as `home-assistant`, `lovelace`, `custom-card` and `hacs`. Commit `dist/room-overview-card.js` alongside the root `README.md`, `LICENSE` and `hacs.json`. This layout follows the [HACS dashboard repository requirements](https://www.hacs.dev/docs/publish/plugin/).

The default branch is sufficient for a HACS custom repository; GitHub releases are optional. Initially, use the committed `dist/` module without publishing release assets. If adding versioned releases later, create a GitHub release from a commit containing the built module and verify HACS installs that version. The ZIP produced by `npm run package` is for manual installation; do not upload it as a HACS release asset.

Only this standalone repository should be published. Do not import a private Home Assistant workspace's Git history, dashboards, entity/device snapshots, connection settings or room images. Every YAML example uses placeholder IDs that must be replaced with IDs from the installer's own system.

## Development and validation

Requires Node.js 20 or newer for development. There are no npm/runtime dependencies.

```sh
npm run check
npm run package
```

`check` runs the discovery, configuration, sensor, warning, shared registry and Media image resolution tests, builds the self-contained module, and checks its syntax. The bundle version is read from `package.json`. `package` rebuilds the module and produces a manual-install ZIP in `releases/`; Python 3 is used only to create that ZIP. The ZIP contains only the README, licence, HACS metadata and JavaScript module.

GitHub Actions run these checks, verify the committed bundle matches the source, and validate the repository with HACS using category `plugin`. The HACS README image check is skipped because this custom repository contains no documentation screenshots; screenshots are required when submitting to the default HACS catalogue. HACS validation can only run against the hosted GitHub repository.

The card shares one registry cache/subscription per Home Assistant connection and refreshes on Area, device and entity registry changes or reconnect. Current device values update with normal Home Assistant state updates. No helpers, backend integration or automations are created.

For browser checks, serve this folder locally (for example `python3 -m http.server 8769 --bind 127.0.0.1`) and open `http://localhost:8769/tests/browser.html`. This fixture uses simulated devices and records service calls on the page. Use it to check device and entity exclusion searches, restoring selections, the four dropdowns, omitted tiles, row alignment, room changes, sensor warnings, failure recovery, power toggles and light gradient sliders without operating real devices. When automating number fields, type with keyboard events and blur; programmatic value filling alone may not emit the native change event.

## Remove

Remove the cards and their resource, then delete the installed folder (or remove the HACS repository). Room pictures and other native Area settings belong to Home Assistant and remain available for other dashboards.
