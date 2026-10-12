import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverRoom, validateConfig } from '../../src/control/model.js';
import { readableName, presentRoom } from '../../src/control/presentation.js';
const baseRoom = { name: 'Example', area: { name: 'Example', area_id: 'example' }, registry: new Map(), entities: [] };
const entity = (domain, key, dc, state = 'off', friendly = `example.${domain}.${key}`) => ({ entity_id: `${domain}.${key}`, state, attributes: { friendly_name: friendly, ...(dc ? { device_class: dc } : {}) } });
test('technical labels shorten in any room and preserve meaningful device hierarchy', () => {
  assert.equal(readableName(entity('light', 'bedside.danny'), baseRoom), 'Bedside · Danny');
  assert.equal(readableName(entity('media_player', 'speaker', null, 'idle', 'example.speaker.wiim.music_assistant'), baseRoom), 'WiiM · Music Assistant');
  assert.equal(readableName(entity('camera', 'cam', null, 'idle', 'example.camera.doorbell.live_view'), baseRoom), 'Doorbell');
  assert.equal(readableName(entity('light', 'lamp', null, 'off', 'Reading lamp'), baseRoom), 'Reading lamp');
  assert.equal(readableName(entity('light', 'lamp', null, 'off', 'St.John'), baseRoom), 'St.John');
  assert.equal(readableName(entity('light', 'lamp', null, 'off', 'reiko_study.light.wall'), { ...baseRoom, name: 'Reiko Study', area: { area_id: 'kids_study', name: 'Reiko Study' } }), 'Wall');
});
test('event history is not mistaken for current presence', () => {
  const result = presentRoom({ ...baseRoom, entities: [entity('event', 'motion', 'motion', '2026-10-01T01:00:00Z'), entity('binary_sensor', 'presence', 'motion', 'off')] });
  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].value, 'Clear');
  assert.equal(result.details[0].name, 'Events & history');
});
test('healthy batteries stay in details; low and missing batteries become visible warnings', () => {
  const result = presentRoom({ ...baseRoom, entities: [entity('sensor', 'a', 'battery', '100'), entity('sensor', 'b', 'battery', '12'), entity('sensor', 'c', 'battery', 'unavailable')] });
  assert.equal(result.statuses[0].value, '1 low · 1 unavailable');
  assert.equal(result.details[0].entities.length, 3);
});
test('specific setup keys work when metadata is missing without catching everyday modes', () => {
  const setup = entity('select', 'some_remote_click_mode', null, 'fast', 'Remote click mode');
  const ordinary = entity('select', 'mode', null, 'Evening', 'Room mode');
  const result = presentRoom({ ...baseRoom, entities: [setup, ordinary] });
  assert.equal(result.details[0].name, 'Device settings');
  assert.equal(result.details[0].entities[0].entity_id, setup.entity_id);
  assert.equal(result.sections[0].entities[0].entity_id, ordinary.entity_id);
});
test('Always show promotes secondary entities while manual entity/device exclusions still win', () => {
  const setup = entity('select', 'remote_click_mode', null, 'fast');
  const event = entity('event', 'doorbell', 'doorbell', '2026-10-01T01:00:00Z');
  const light = entity('light', 'lamp');
  const config = validateConfig({ area: 'example', include_hidden: false, always_show: [setup.entity_id, event.entity_id, light.entity_id], exclude_entities: [event.entity_id], exclude_devices: ['removed-device'] });
  const registry = { areas: [baseRoom.area], devices: [{ id: 'removed-device', area_id: 'example' }], entities: [setup, event, light].map(entity => ({ entity_id: entity.entity_id, area_id: 'example', ...(entity === light ? { device_id: 'removed-device' } : {}) })) };
  const room = discoverRoom(config, { states: Object.fromEntries([setup, event, light].map(entity => [entity.entity_id, entity])) }, registry);
  const result = presentRoom(room, config);
  assert.deepEqual(result.entityIds, [setup.entity_id]);
  assert.equal(result.sections[0].entities[0].entity_id, setup.entity_id);
  const promotedEvent = presentRoom({ ...baseRoom, entities: [event] }, { always_show: [event.entity_id] });
  assert.equal(promotedEvent.statuses[0].entities[0].entity_id, event.entity_id);
});
test('different media backends remain distinct and duplicate natural labels are disambiguated', () => {
  const a = entity('media_player', 'a', null, 'idle', 'example.speaker.wiim');
  const b = entity('media_player', 'b', null, 'idle', 'example.speaker.wiim.music_assistant');
  const c = entity('light', 'c', null, 'off', 'Lamp'), d = entity('light', 'd', null, 'off', 'Lamp');
  const result = presentRoom({ ...baseRoom, entities: [a, b, c, d] });
  assert.equal(result.sections.find(group => group.name === 'Media').entities.length, 2);
  assert.notEqual(result.sections[0].entities[0].name, result.sections[0].entities[1].name);
});
test('heterogeneous power and status sensors are not merged into invented totals', () => {
  const result = presentRoom({ ...baseRoom, entities: [entity('sensor', 'charger_power', 'power', '5'), entity('sensor', 'solar_power', 'power', '2')] });
  assert.equal(result.statuses.length, 2);
  assert.deepEqual(result.statuses.map(group => group.value), ['5', '2']);
});
test('generated device prefixes shorten while explicit natural names stay intact', () => {
  const reading = entity('sensor', 'solar_power', 'power', '3', 'Solar forecast Estimated power now');
  const room = { ...baseRoom, registry: new Map([[reading.entity_id, { device_id: 'solar' }]]), devices: new Map([['solar', { name: 'Solar forecast' }]]) };
  assert.equal(readableName(reading, room), 'Estimated power now');
  room.registry.get(reading.entity_id).name = 'Solar forecast Estimated power now';
  assert.equal(readableName(reading, room), 'Solar forecast Estimated power now');
});
test('registry class overrides and mixed units retain separate native badge identities', () => {
  const a = entity('sensor', 'a', 'temperature', '21'); a.attributes.unit_of_measurement = '°C';
  const b = entity('sensor', 'b', 'temperature', '70'); b.attributes.unit_of_measurement = '°F';
  const c = entity('sensor', 'c', 'battery', '0');
  const result = presentRoom({ ...baseRoom, entities: [a, b, c], registry: new Map([[c.entity_id, { device_class: 'voltage' }]]) });
  assert.equal(result.statuses.length, 2);
  assert.notEqual(result.statuses[0].key, result.statuses[1].key);
  assert.equal(result.details[0].entities[0].attributes.device_class, 'voltage');
});
