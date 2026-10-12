export const CARD_STYLES = `
:host{display:block;min-width:0;color:var(--primary-text-color);container-type:inline-size}
[hidden]{display:none!important}.room-content{display:flex;flex-direction:column;gap:16px;min-width:0}.message{padding:12px;color:var(--secondary-text-color)}
.badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap}ha-badge{max-width:100%}
.sections{display:flex;flex-direction:column;gap:16px}.sections>section{min-width:0;display:flex;flex-direction:column;gap:8px}.native-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.native-tiles>*{min-width:0}.details-content{display:flex;flex-direction:column;gap:12px;padding-top:8px}.cameras{display:flex;flex-direction:column;gap:8px}.camera-content{max-width:640px;width:100%;margin-inline:auto}.camera-nav{display:flex;align-items:center;justify-content:center;gap:12px}.camera-count{color:var(--secondary-text-color);font-size:var(--ha-font-size-s,14px)}
@container(max-width:540px){.native-tiles{grid-template-columns:minmax(0,1fr)}}
`;
