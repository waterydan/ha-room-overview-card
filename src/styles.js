export const CARD_STYLE = `
:host{display:block;min-width:0;font-family:var(--ha-font-family-body,inherit);color:var(--primary-text-color)}
*{box-sizing:border-box}ha-button{--ha-button-label-overflow:visible;--wa-color-on-normal:currentColor;--wa-color-on-quiet:currentColor;--wa-form-control-padding-inline:0}
/* The host owns each button's shape; size and align HA's native shadow parts too. */
ha-button::part(base){box-sizing:border-box;min-width:0;min-height:0;height:100%;padding:0;border:0;border-radius:inherit;background:transparent;box-shadow:none;color:inherit;font:inherit;line-height:inherit}
ha-button::part(label){min-width:0;padding:0;line-height:inherit;white-space:inherit}
ha-card{display:block;position:relative;height:212px;overflow:hidden;border-radius:16px;background:var(--ha-card-background,var(--card-background-color,#27313b));isolation:isolate}
:host([data-layout-height=true]){height:100%;min-height:0}ha-card[data-layout-height=true]{height:100%;min-height:0}
:host ha-card::before{content:none}
ha-card[data-lit=true]{outline:3px solid #ffca28;outline-offset:-2px;box-shadow:0 0 0 2px #ffca28cc,0 0 16px #ffca28e6,0 0 32px #ffca28a6,0 0 48px #ffca2859}
.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.shade{position:absolute;inset:0;background:linear-gradient(180deg,#0009 0%,#0002 40%,transparent 65%,#0002 100%);z-index:-1}
.heading{position:absolute;inset:12px 12px auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 8px;align-items:start}.room-summary{display:contents}.room-button{display:flex;align-items:center;width:100%;height:24px;border:0;background:none;padding:0;color:white;text-align:left;font-size:14px;font-weight:600;text-shadow:0 1px 3px #0009;min-width:0}.room-button::part(base){width:100%;justify-content:flex-start}.room-button::part(label){display:flex;align-items:center;gap:8px;overflow:hidden;text-align:left}.room-button ha-icon{display:block;--mdc-icon-size:20px;flex-shrink:0}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.readings{grid-column:1/-1;margin:0 0 0 28px;display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;font-size:12px;color:#fff;line-height:18px;text-shadow:0 1px 3px #0009}.reading{display:inline-flex;flex:none;align-items:center;height:18px;padding:0;border:0;background:none;color:inherit;font:inherit;white-space:nowrap}.reading+.reading::before{content:'|';margin-right:6px;opacity:.7}
.status-row{grid-column:2;grid-row:1;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:168px}.warnings,.sensor-status{display:flex;gap:4px}.warnings:empty,.sensor-status:empty,.sensor-status[hidden],.sensor-indicator[hidden]{display:none}
.warning,.sensor-indicator{width:24px;height:24px;padding:0;border:0;border-radius:6px;display:grid;place-items:center;flex-shrink:0}.warning::part(base),.sensor-indicator::part(base),.tile::part(base){width:100%}.warning::part(label),.sensor-indicator::part(label),.tile::part(label){display:flex;align-items:center;justify-content:center}.warning{background:#e3f2fd;color:#087cca}.warning ha-icon,.sensor-indicator ha-icon{display:block;--mdc-icon-size:18px}.warning[data-kind=temperature_high]{background:#fff3e0;color:#c65d00}.warning[data-kind=humidity_low]{background:#fff8e1;color:#9c6500}
.sensor-indicator{position:relative;background:#eceff1;color:#7d858b}.sensor-indicator[data-active=true]{background:#ffe4e6;color:#a86070}.sensor-indicator[data-unavailable=true]{background:#e2e8f0;color:#64748b}.sensor-indicator .unavailable-dot{top:-3px;right:-3px;width:10px;height:10px;line-height:10px;font-size:8px}
.tiles{position:absolute;left:10px;right:10px;bottom:10px;display:flex;flex-wrap:nowrap;justify-content:flex-end;gap:6px;align-items:end}.tiles[data-alignment=left]{justify-content:flex-start}.tiles[data-alignment=center]{justify-content:center}.tile{flex:0 1 56px;width:56px;height:56px;min-width:0;display:grid;place-items:center;position:relative;padding:6px;border:var(--ha-card-border,1px solid #ffffff66);border-radius:12px;background:#ffffff80;backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));-webkit-backdrop-filter:var(--ha-card-backdrop-filter,blur(10px) saturate(1.25));box-shadow:var(--ha-card-glass-inset-shadow,none);color:#888}.tile ha-icon{--mdc-icon-size:28px;stroke:#fff;stroke-width:1.5px;stroke-linejoin:round;paint-order:stroke fill}.tile[data-active=true]{color:#ffca28}.tile[data-unavailable=true]{color:#64748b}.unavailable-dot{position:absolute;top:5px;right:5px;width:12px;height:12px;border-radius:50%;background:#455a64;color:white;font-size:10px;line-height:12px;text-align:center}.unavailable-dot[hidden]{display:none}
.message{position:absolute;left:12px;right:12px;bottom:14px;color:#fff;font-size:12px;text-shadow:0 1px 3px #000}.message[hidden]{display:none}ha-card[data-has-controls=true] .message{bottom:76px}
ha-card[data-mode=simple]{height:auto;aspect-ratio:1;width:100%;container-type:inline-size}
ha-card[data-mode=simple][data-layout-height=true]{height:100%;aspect-ratio:auto;container-type:size}
.simple-tile{--ha-button-height:100%;position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;border:0;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;text-align:center}
.simple-tile::part(base){width:100%;height:100%}.simple-tile::part(label){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.simple-tile ha-icon{--mdc-icon-size:50cqi;flex-shrink:0}
.simple-tile[data-has-text=true] ha-icon{--mdc-icon-size:35cqi}
ha-card[data-layout-height=true] .simple-tile ha-icon{--mdc-icon-size:50cqmin}
ha-card[data-layout-height=true] .simple-tile[data-has-text=true] ha-icon{--mdc-icon-size:35cqmin}
.simple-title,.simple-state{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;max-width:100%;color:var(--primary-text-color,#222);font-size:12px;line-height:1.2;font-weight:500}
.simple-state{color:var(--secondary-text-color,#666);font-size:11px;font-weight:400}
.simple-title[hidden],.simple-state[hidden]{display:none}
@container(max-width:140px) or (max-height:140px){.simple-tile[data-has-text=true]{gap:4px;padding:6px}.simple-title{font-size:11px;-webkit-line-clamp:1}.simple-state{font-size:10px;-webkit-line-clamp:1}}
@container(max-width:80px) or (max-height:80px){.simple-tile[data-has-text=true]{gap:2px;padding:4px}.simple-title,.simple-state{font-size:10px}}
.simple-tile[hidden],ha-card[data-mode=simple]>.heading,ha-card[data-mode=simple]>.tiles,ha-card[data-mode=simple]>.background,ha-card[data-mode=simple]>.shade{display:none}
ha-card[data-mode=simple]>.message{inset:0;display:grid;place-items:center;padding:4px;background:var(--ha-card-background,var(--card-background-color,#27313b));color:var(--primary-text-color);text-shadow:none;text-align:center;pointer-events:none}
ha-card[data-mode=simple]>.message[hidden]{display:none}
ha-dialog{--ha-dialog-width-lg:840px;--dialog-content-padding:0 16px 16px;--ha-dialog-surface-background:var(--primary-background-color,var(--card-background-color))}.dialog-body,.control-container{min-width:0}room-control-card{display:block}

ha-card[data-has-image=false] .shade{display:none}
ha-card[data-has-image=false] .room-button{color:var(--primary-text-color,#222);text-shadow:none}
ha-card[data-has-image=false] .readings,ha-card[data-has-image=false] .message{color:var(--secondary-text-color,#666);text-shadow:none}
ha-card[data-has-image=false] .tile{background:var(--secondary-background-color,#e8eef3);border:1px solid var(--divider-color,#ddd);backdrop-filter:none;-webkit-backdrop-filter:none}
ha-card[data-has-image=false] .tile ha-icon{stroke:none}

`;
export const EDITOR_STYLE = `
:host{display:block;color:var(--primary-text-color);font-family:var(--ha-font-family-body,inherit)}*{box-sizing:border-box}ha-selector{display:block;width:100%}.editor{padding:4px 0}.field{display:block;margin:0 0 16px}.hint{font-size:var(--ha-font-size-s,14px);color:var(--secondary-text-color);line-height:1.5;margin:6px 0 16px}.slots,.unit-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.section-title{font-weight:var(--ha-font-weight-medium,500);margin:18px 0 12px}.reset{margin-bottom:12px}.advanced,.exclusions,.specific-entities{margin-top:12px}.error{color:var(--error-color)}.error:empty{display:none}
@media(max-width:420px){.slots,.unit-grid{grid-template-columns:1fr}}
`;
