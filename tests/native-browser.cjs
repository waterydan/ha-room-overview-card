const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, serviceWorkers: 'block' });
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.stack));
  await page.route('**/api/camera_proxy/**', route => route.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, 'tests/fixtures/camera.svg')) }));
  await page.route('**/__native-camera.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, 'tests/fixtures/camera.svg')) }));
  // This official demo provides actual HA components. Our entities and service
  // methods replace its simulated data; no test operates a real device.
  await page.goto('https://demo.home-assistant.io/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.loadCardHelpers === 'function');
  await page.evaluate(async () => { await window.loadCardHelpers(); window.baseNativeHass = [...document.querySelectorAll('*')].find(element => element.hass)?.hass; });
  await page.addScriptTag({ path: process.env.ROOM_PACKAGE_BUNDLE || path.join(root, 'dist/room-overview-card.js') });
  await page.waitForFunction(() => !!customElements.get('room-overview-card'));
  await page.evaluate(() => {
    const definitions = [
      ['light.bench','native.light.bench','off',{supported_color_modes:['onoff']}],
      ['light.cabinet','native.light.cabinet','off',{supported_color_modes:['color_temp'],brightness:120}],
      ['switch.plug','native.plug.sandwich_press','off',{}],
      ['fan.shower','native.fan.shower','off',{supported_features:1,percentage:40}],
      ['climate.room','native.climate.thermostat','heat',{supported_features:1,hvac_modes:['off','heat'],temperature:21,current_temperature:20,min_temp:7,max_temp:35,target_temp_step:.5}],
      ['media_player.speaker','native.speaker.sonos','paused',{supported_features:16389,volume_level:.3}],
      ['cover.gate','native.cover.gate','closed',{supported_features:7,current_position:0}],
      ['binary_sensor.door','native.sensor.door','off',{device_class:'door'}],
      ['binary_sensor.motion','native.sensor.motion','off',{device_class:'motion'}],
      ['sensor.temperature','native.sensor.climate.temperature','20',{device_class:'temperature',unit_of_measurement:'°C'}],
      ['sensor.humidity','native.sensor.climate.humidity','50',{device_class:'humidity',unit_of_measurement:'%'}],
      ['sensor.battery','native.sensor.remote.battery','100',{device_class:'battery',unit_of_measurement:'%'}],
      ['event.motion','native.camera.doorbell.motion','2026-01-01T00:00:00Z',{device_class:'motion'}],
      ['select.click_mode','native.button.remote.click_mode','fast',{options:['fast','slow']}],
      ['button.identify','native.sensor.door.identify','unknown',{device_class:'identify'}],
      ['update.firmware','native.sensor.door.firmware','off',{}],
      ['automation.arrival','Native - Anyone arrives >> Lights on','on',{}],
      ['camera.first','native.camera.front','idle',{entity_picture:'/__native-camera.svg'}],
      ['camera.second','native.camera.driveway','idle',{entity_picture:'/__native-camera.svg'}],
    ];
    const areas=[{area_id:'native',name:'Native',icon:'mdi:home-outline'},{area_id:'empty',name:'Empty'}];
    const devices=[{id:'light-device',area_id:'native',name:'Lighting'},{id:'remote-device',area_id:'native',name:'Remote'}];
    const entities=definitions.map(([entity_id])=>({entity_id,area_id:'native',device_id:entity_id.startsWith('light.')?'light-device':entity_id==='select.click_mode'?'remote-device':null,...(entity_id==='button.identify'?{entity_category:'config'}:{}),...(entity_id==='sensor.battery'?{entity_category:'diagnostic',original_device_class:'battery'}:{})}));
    const states=Object.fromEntries(definitions.map(([entity_id,friendly_name,state,attributes])=>[entity_id,{entity_id,state,attributes:{friendly_name,...attributes},last_changed:'2026-01-01T00:00:00Z',last_updated:'2026-01-01T00:00:00Z',context:{id:'native-test',parent_id:null,user_id:null}}]));
    const events=new Map(), services=[];let reads=0;
    const connection={subscribeEvents:async(fn,type)=>{if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);return()=>events.get(type).delete(fn)},addEventListener(){},removeEventListener(){}};
    const hass={...window.baseNativeHass,states,areas:Object.fromEntries(areas.map(area=>[area.area_id,area])),devices:Object.fromEntries(devices.map(device=>[device.id,device])),entities:Object.fromEntries(entities.map(entity=>[entity.entity_id,entity])),connection,
      callWS:async message=>{reads++;if(message.type.includes('area_registry'))return areas;if(message.type.includes('device_registry'))return devices;if(message.type.includes('entity_registry'))return entities;if(message.type.startsWith('config_entries/'))return[];return{}},
      callApi:async(method,path)=>path.startsWith('config/config_entries/entry')?[]:{},
      callService:async(domain,service,data,target)=>{services.push({domain,service,data,target});const id=target?.entity_id||data?.entity_id;const entity=states[Array.isArray(id)?id[0]:id];if(entity&&['turn_on','turn_off','toggle'].includes(service)){entity.state=service==='turn_off'?'off':service==='turn_on'?'on':entity.state==='on'?'off':'on';render()}}};
    const card=document.createElement('room-overview-card'),editor=document.createElement('room-overview-card-editor');
    for(const element of [...document.body.children])element.style.display='none';document.body.append(card);document.body.style.margin='24px';document.body.style.maxWidth='1000px';
    let config={area:'native',overview_exclusions:{devices:[],entities:['light.bench']},control_exclusions:{devices:[],entities:[]},control_options:{layout:'grouped'}};
    const contextCallbacks=new Set();let currentHass;
    const wholeContexts=new Set(['hass','hassApi','hassInternationalization','hassUi','hassConfig','hassFormatters','hassConnection','hassRegistries']);
    function contextValue(key,value){if(wholeContexts.has(key))return value;if(['states','services','entities','devices','areas','floors','themes','selectedTheme','connection','localize','locale','config','auth','user','panels','userData'].includes(key))return value[key]||{};if(key==='extendedEntities')return entities;if(key==='labels'||key==='configEntries')return[];if(key==='manifests')return{};if(key==='narrowViewport')return innerWidth<768;if(key==='reducedMotion')return false;return undefined}
    document.body.addEventListener('context-request',event=>{
      const value=contextValue(event.context,currentHass||hass);
      if(value!==undefined){event.stopPropagation();const item={key:event.context,callback:event.callback};if(event.subscribe)contextCallbacks.add(item);event.callback(value,()=>contextCallbacks.delete(item));}
    });
    function render(){currentHass={...hass,states:Object.fromEntries(Object.entries(states).map(([id,state])=>[id,{...state,attributes:{...state.attributes}}]))};card.hass=currentHass;editor.hass=currentHass;for(const item of contextCallbacks)item.callback(contextValue(item.key,currentHass))}
    function setConfig(value){config=value;card.setConfig(config);editor.setConfig(config);render()}
    editor.addEventListener('config-changed',event=>setConfig(event.detail.config));
    setConfig(config);
    window.nativeFixture={card,editor,hass,states,areas,devices,entities,events,services,render,setConfig,get reads(){return reads},emit:type=>{for(const fn of events.get(type)||[])fn({})}};
  });
  const card = page.locator('room-overview-card');
  const dialog = card.locator('ha-dialog');
  const control = card.locator('room-control-card');
  const open = async () => { const delay=await card.evaluate(node=>Math.max(0,(node._ignoreClickUntil||0)-Date.now()));if(delay)await page.waitForTimeout(delay+10);await card.locator('.room-button').click(); await control.locator('.sections hui-entities-card, .sections hui-tile-card').first().waitFor(); await dialog.locator('dialog').waitFor({state:'visible'}); };
  const close = async () => { await dialog.getByRole('button',{name:'Close',exact:true}).click(); await control.waitFor({state:'detached'}); };
  let checks=0;const pass=message=>{checks++;console.log('PASS '+message)};
  try {
    await card.locator('.reading').first().waitFor();
    await page.evaluate(()=>{const f=nativeFixture;f.states['binary_sensor.motion'].state='on';f.states['binary_sensor.door'].state='on';f.states['sensor.temperature'].state='35';f.states['sensor.humidity'].state='15';f.setConfig({...f.card._config,name:'A long room name that must stay inside its heading'});});
    for(const width of [192,320,445]){
      await card.evaluate((node,width)=>{node.style.width=width+'px'},width);
      const geometry=await card.evaluate(node=>{
        const root=node.shadowRoot,rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
        const heading=root.querySelector('.heading');
        return{heading:rect(heading),title:rect(root.querySelector('.room-button')),titleIcon:rect(root.querySelector('.room-button ha-icon')),name:rect(root.querySelector('.name')),readings:[...root.querySelectorAll('.reading')].map(n=>({host:rect(n),base:rect(n.shadowRoot.querySelector('[part=base]')),label:rect(n.shadowRoot.querySelector('[part=label]'))})),buttons:[...root.querySelectorAll('.sensor-indicator,.warning,.tiles .tile')].filter(n=>!n.hidden).map(n=>({host:rect(n),base:rect(n.shadowRoot.querySelector('[part=base]')),icon:rect(n.querySelector('ha-icon'))}))};
      });
      assert.ok(Math.abs(geometry.titleIcon.x-geometry.heading.x)<1,'room icon stays at the left edge');
      assert.ok(Math.abs(geometry.name.x-geometry.titleIcon.right-8)<1,'room name follows the icon with an 8px gap');
      assert.ok(geometry.name.right<=geometry.title.right+1,'long room name stays inside its button');
      for(const reading of geometry.readings){assert.equal(reading.host.height,18);assert.equal(reading.base.height,18);assert.ok(reading.label.y>=reading.host.y-1&&reading.label.bottom<=reading.host.bottom+1,JSON.stringify(reading));assert.ok(Math.abs(reading.host.x-geometry.name.x)<1||reading.host.x>geometry.name.x);}
      if(width>=320)assert.ok(Math.abs(geometry.readings[0].label.y-geometry.readings[1].label.y)<1,'temperature and humidity share a baseline');
      for(const button of geometry.buttons){assert.ok(button.icon.x>=button.host.x-1&&button.icon.right<=button.host.right+1&&button.icon.y>=button.host.y-1&&button.icon.bottom<=button.host.bottom+1,'icons stay inside their badges or tiles');assert.ok(button.base.y>=button.host.y-1&&button.base.bottom<=button.host.bottom+1,'native button stays inside its host');}
    }
    await card.evaluate(node=>node.style.removeProperty('width'));
    await page.evaluate(()=>{const f=nativeFixture;f.states['binary_sensor.motion'].state='off';f.states['binary_sensor.door'].state='off';f.states['sensor.temperature'].state='20';f.states['sensor.humidity'].state='50';const {name,...config}=f.card._config;f.setConfig(config);});
    pass('room names, climate readings and active sensor/warning icons fit native buttons at narrow and desktop card widths');
    await card.locator('.name').waitFor();await open();
    assert.equal(await control.evaluate(node=>node._config.layout),'compact');
    assert.equal(await control.locator('ha-badge').count(),4);
    assert.equal(await control.locator('ha-badge[data-sensor="sensor:temperature:°C"]').count(),1);
    assert.equal(await control.locator('.sections hui-entities-card').first().evaluate(node=>node._config.show_header_toggle),false);
    assert.deepEqual(await control.locator('[data-native-key="rows:Lights"]').evaluate(node=>node._config.entities.map(entity=>entity.name)),['Bench','Cabinet']);
    assert.equal(await control.locator('hui-tile-card').count(),4);
    assert.equal(await control.locator('hui-picture-entity-card').count(),1);
    assert.equal(await page.evaluate(()=>nativeFixture.services.length),0);
    pass('native rows, feature tiles, picture cards and real HA badges render without service calls');
    const switchRow=control.locator('[data-native-key="rows:Lights"] hui-toggle-entity-row').first();
    const switchBounds=await switchRow.getByRole('switch').boundingBox();await page.mouse.click(switchBounds.x+switchBounds.width/2,switchBounds.y+switchBounds.height/2);
    await page.waitForFunction(()=>nativeFixture.services.length===1);
    const command=await page.evaluate(()=>nativeFixture.services[0]);assert.equal(command.domain,'light');assert.match(command.service,/turn_on|toggle/);assert.equal(command.data.entity_id||command.target?.entity_id,'light.bench');
    pass('the native light switch targets the selected entity');
    await page.evaluate(()=>{window.keptRows=nativeFixture.card._control.shadowRoot.querySelector('[data-native-key="rows:Lights"]');nativeFixture.states['sensor.temperature'].state='23';nativeFixture.render()});
    assert.equal(await page.evaluate(()=>keptRows===nativeFixture.card._control.shadowRoot.querySelector('[data-native-key="rows:Lights"]')),true);
    assert.equal(await control.locator('ha-badge[data-sensor="sensor:temperature:°C"]').evaluate(node=>node.querySelector('span').textContent),'23 °C');
    pass('state updates preserve mounted native controls and update badge readings');
    await control.locator('ha-badge[data-sensor="sensor:temperature:°C"]').click();
    assert.equal(await control.locator('.sensor-detail').evaluate(node=>node.expanded),true);
    await page.keyboard.press('Escape');assert.equal(await control.locator('.sensor-detail').evaluate(node=>node.hidden),true);
    assert.equal(await dialog.evaluate(node=>node.open),true);
    await control.locator('.room-details').getByRole('button',{name:/More room details/}).click();
    await control.locator('[data-native-key="details:Device settings"] hui-select-entity-row').waitFor({state:'visible'});
    assert.equal(await control.locator('[data-native-key="details:Events & history"]').count(),1);
    assert.equal(await control.locator('[data-native-key="details:Batteries"]').count(),1);
    assert.equal(await control.locator('.badges').textContent().then(text=>text.includes('2026-')),false);
    pass('secondary settings, healthy batteries and history use native expandable details');
    const previousCamera=await control.locator('hui-picture-entity-card').evaluate(node=>node._config.entity);await control.locator('.next').click();assert.notEqual(await control.locator('hui-picture-entity-card').evaluate(node=>node._config.entity),previousCamera);
    await page.evaluate(()=>{nativeFixture.card._dialog.bodyContainer.scrollTop=100;window.keptScroll=nativeFixture.card._dialog.bodyContainer.scrollTop;nativeFixture.states['sensor.temperature'].state='24';nativeFixture.render()});
    assert.equal(await page.evaluate(()=>nativeFixture.card._dialog.bodyContainer.scrollTop),await page.evaluate(()=>keptScroll));
    pass('native camera navigation and room scrolling survive state updates');
    await close();
    await page.evaluate(()=>nativeFixture.setConfig({...nativeFixture.card._config,control_exclusions:{devices:['light-device'],entities:[]}}));await open();
    assert.equal(await control.locator('[data-native-key="rows:Lights"]').count(),0);await close();
    await page.evaluate(()=>nativeFixture.setConfig({...nativeFixture.card._config,control_exclusions:{devices:[],entities:[]},control_options:{layout:'compact',always_show:['select.click_mode','button.identify']}}));await open();
    assert.ok((await control.locator('.sections').evaluate(node=>[...node.querySelectorAll('hui-entities-card')].flatMap(card=>card._config.entities.map(entity=>entity.entity)))).includes('button.identify'));await close();
    await page.evaluate(()=>nativeFixture.setConfig({...nativeFixture.card._config,control_exclusions:{devices:[],entities:['button.identify']}}));await open();
    assert.ok(!(await control.locator('.sections').evaluate(node=>[...node.querySelectorAll('hui-entities-card')].flatMap(card=>card._config.entities.map(entity=>entity.entity)))).includes('button.identify'));await close();
    pass('independent overview/device exclusions and Always show precedence hold with native cards');
    await page.evaluate(()=>{document.body.append(nativeFixture.editor)});const editor=page.locator('room-overview-card-editor');await editor.locator('ha-selector').first().waitFor();
    assert.equal(await editor.locator('ha-selector').count()>10,true);
    assert.equal(await editor.evaluate(node=>node.shadowRoot.querySelectorAll('input,select,textarea,button,details').length),0);
    for(const key of ['overview_exclusions.devices','overview_exclusions.entities','control_exclusions.devices','control_exclusions.entities','control_options.always_show'])assert.equal(await editor.locator(`[data-key="${key}"]`).count(),1);
    await editor.locator('[data-key="control_options.include_diagnostics"]').evaluate(node=>node.dispatchEvent(new CustomEvent('value-changed',{detail:{value:true},bubbles:true,composed:true})));
    assert.equal(await page.evaluate(()=>nativeFixture.card._config.control_options.include_diagnostics),true);
    await editor.evaluate(node=>node.remove());
    pass('the editor uses native selectors and both exclusion lists are visible');
    await page.evaluate(()=>nativeFixture.setConfig({...nativeFixture.card._config,control_options:{layout:'compact'}}));
    await card.locator('.room-button').focus();await page.keyboard.press('Enter');await control.waitFor({state:'visible'});await close();
    await card.locator('.room-button').dispatchEvent('pointerdown',{pointerId:1,isPrimary:true,pointerType:'touch',button:0,clientX:30,clientY:30});await page.waitForTimeout(600);await control.waitFor({state:'visible'});await close();
    pass('keyboard and hold activation open the native dialog');
    await page.evaluate(async()=>{const helpers=await window.loadCardHelpers();window.nativeThemeProbe=helpers.createCardElement({type:'entities',entities:[],theme:'default'});nativeThemeProbe.hidden=true;document.body.append(nativeThemeProbe);});
    const applyTheme=async theme=>page.evaluate(async theme=>{
      const f=nativeFixture;f.hass.themes={...f.hass.themes,darkMode:theme==='dark'};f.hass.selectedTheme={...f.hass.selectedTheme,theme:'default',dark:theme==='dark'};f.render();nativeThemeProbe.remove();const helpers=await window.loadCardHelpers();window.nativeThemeProbe=helpers.createCardElement({type:'entities',entities:[],theme:'default'});nativeThemeProbe.hidden=true;nativeThemeProbe.hass={...f.hass};document.body.append(nativeThemeProbe);await nativeThemeProbe.updateComplete;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      for(const name of window.previousThemeKeys||[])document.body.style.removeProperty(name);
      const nativeTheme=getComputedStyle(nativeThemeProbe.shadowRoot.querySelector('ha-card')||nativeThemeProbe);window.previousThemeKeys=[...nativeTheme].filter(name=>name.startsWith('--'));
      for(const name of previousThemeKeys)document.body.style.setProperty(name,nativeTheme.getPropertyValue(name));
      document.documentElement.style.colorScheme=theme;document.body.style.background='var(--primary-background-color)';f.render();
    },theme);
    const screenshots=path.join(root,'docs/images');fs.mkdirSync(screenshots,{recursive:true});
    for(const theme of ['light','dark'])for(const width of [390,620,1100]){
      await page.setViewportSize({width,height:1050});
      await applyTheme(theme);
      await open();await page.waitForTimeout(100);
      const bounds=await dialog.locator('dialog').boundingBox();assert.ok(bounds.width<=width+1);const background=await dialog.locator('dialog').evaluate(node=>getComputedStyle(node).backgroundColor);const rgb=background.match(/[0-9.]+/g).slice(0,3).map(Number);assert.equal(rgb.reduce((a,b)=>a+b,0)/3<128,theme==='dark',`native ${theme} appearance: ${background}`);
      assert.equal(await control.evaluate(node=>node.shadowRoot.querySelector('.room-content').scrollWidth>node.shadowRoot.querySelector('.room-content').clientWidth+1),false);
      await dialog.locator('dialog').screenshot({path:path.join(screenshots,`native-controls-${theme}-${width}.png`)});await close();
    }
    pass('native dialogs and controls fit phone, tablet and desktop in light and dark themes');
    if(process.env.ROOM_NATIVE_DATA){
      const data=JSON.parse(fs.readFileSync(process.env.ROOM_NATIVE_DATA));
      await page.evaluate(data=>{const f=nativeFixture;f.areas.splice(0,f.areas.length,...data.areas);f.devices.splice(0,f.devices.length,...data.devices);f.entities.splice(0,f.entities.length,...data.entities);for(const key of Object.keys(f.states))delete f.states[key];for(const state of data.states){f.states[state.entity_id]={...state,attributes:{...state.attributes,...(state.entity_id.startsWith('camera.')?{entity_picture:'/__native-camera.svg'}:{})}};}f.hass.areas=Object.fromEntries(f.areas.map(a=>[a.area_id,a]));f.hass.devices=Object.fromEntries(f.devices.map(d=>[d.id,d]));f.hass.entities=Object.fromEntries(f.entities.map(e=>[e.entity_id,e]));f.emit('area_registry_updated');},data);
      await page.waitForTimeout(200);let count=0;
      for(const theme of ['light','dark'])for(const width of [390,620,1100])for(const config of data.cards){
        await page.setViewportSize({width,height:1050});await applyTheme(theme);await page.evaluate(config=>nativeFixture.setConfig({...config,control_options:{...config.control_options,layout:'compact'}}),config);await open();
        assert.equal(await control.evaluate(node=>node.shadowRoot.querySelector('.room-content').scrollWidth>node.shadowRoot.querySelector('.room-content').clientWidth+1),false,`${config.area} ${width}`);
        if(theme==='dark'&&width===1100){const directory=process.env.ROOM_NATIVE_SCREENSHOTS||path.join(path.dirname(process.env.ROOM_NATIVE_DATA),'screenshots');fs.mkdirSync(directory,{recursive:true});await dialog.locator('dialog').screenshot({path:path.join(directory,`native-room-${config.area}.png`)});}await close();count++;
      }
      pass(`${data.cards.length} actual room configurations fit ${count} room/theme/width combinations`);
    }
    await page.addScriptTag({path:path.join(root,'dist/room-overview-card-demo.js')});
    await page.evaluate(()=>{const card=document.createElement('room-overview-card-demo');card.setConfig({area:nativeFixture.areas[0].area_id});card.hass=nativeFixture.hass;document.body.append(card);window.isolatedCard=card});
    const isolated=page.locator('room-overview-card-demo');await isolated.locator('.room-button').click();await isolated.locator('room-control-card-demo').waitFor({state:'visible'});assert.equal(await isolated.locator('room-control-card').count(),0);await isolated.evaluate(node=>node.remove());
    pass('the isolated demo mounts its own native control element');
    assert.deepEqual(errors,[]);pass('no browser runtime errors');
    const result={checks,nativeComponents:true,actualRooms:!!process.env.ROOM_NATIVE_DATA,errors};if(process.env.ROOM_NATIVE_REPORT)fs.writeFileSync(process.env.ROOM_NATIVE_REPORT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  } catch(error) { await page.screenshot({path:'/private/tmp/room-native-test-error.png',fullPage:true});console.error('Runtime errors:',errors);throw error; } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
