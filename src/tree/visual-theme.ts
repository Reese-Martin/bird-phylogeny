export interface ColorPalette { paper:string; muted:string; observed:string; accent:string; ink:string; ring:string; label:string; surface:string; line:string }
export const LIGHT_COLORS:Readonly<ColorPalette> = Object.freeze({ paper: '#f6f4ef', muted: '#dedad2', observed: '#1e1e24', accent: '#92140c', ink: '#1e1e24', ring: '#dedad2', label: '#5f5f69', surface: '#ebe8e1', line: '#857f74' });
export const DARK_COLORS:Readonly<ColorPalette> = Object.freeze({ paper: '#17191c', muted: '#454b54', observed: '#ecebe7', accent: '#ef9a85', ink: '#ecebe7', ring: '#353a41', label: '#b0b5bd', surface: '#22262b', line: '#8b939e' });
/** Default retained for callers that render without a browser theme. */
export const COLORS = LIGHT_COLORS;
export const themeColors = (theme:'light'|'dark'):Readonly<ColorPalette> => theme==='dark'?DARK_COLORS:LIGHT_COLORS;
export function colorWithAlpha(color:string,alpha:number) {
  const rgb=color.replace(/^#/,'');
  return `rgba(${Number.parseInt(rgb.slice(0,2),16)},${Number.parseInt(rgb.slice(2,4),16)},${Number.parseInt(rgb.slice(4,6),16)},${Math.max(0,Math.min(1,alpha))})`;
}
export const FONT = '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif';
export const DISPLAY_FONT = 'Fraunces, Georgia, serif';
export const ORDER_LABELS: Record<string, string> = {
  Passeriformes: 'Perching birds', Anseriformes: 'Waterfowl', Galliformes: 'Landfowl',
  Charadriiformes: 'Shorebirds & allies', Accipitriformes: 'Hawks & allies', Strigiformes: 'Owls',
  Psittaciformes: 'Parrots', Apodiformes: 'Swifts & hummingbirds', Columbiformes: 'Pigeons & doves',
  Piciformes: 'Woodpeckers & allies', Pelecaniformes: 'Herons & allies', Procellariiformes: 'Seabirds',
  Suliformes: 'Cormorants & allies', Gruiformes: 'Cranes & rails', Falconiformes: 'Falcons',
};
export const FAMILY_LABELS: Record<string, string> = {
  Tyrannidae: 'Tyrant flycatchers', Thraupidae: 'Tanagers', Muscicapidae: 'Flycatchers & chats',
  Furnariidae: 'Ovenbirds & woodcreepers', Thamnophilidae: 'Antbirds', Fringillidae: 'Finches',
  Meliphagidae: 'Honeyeaters', Turdidae: 'Thrushes', Cisticolidae: 'Cisticolas & allies',
  Pycnonotidae: 'Bulbuls', Corvidae: 'Crows & jays', Icteridae: 'Blackbirds & orioles',
  Sylviidae: 'Sylviid warblers', Parulidae: 'Wood-warblers', Nectariniidae: 'Sunbirds',
};
