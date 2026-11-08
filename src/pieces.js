// The piece set: original geometric artwork for this app (GPL-3.0-or-later, like the rest of
// the repo). Each piece is drawn in a 100 x 100 box. Colors come from CSS classes, so the
// pieces follow the site's light and dark themes.

const BASE = '<rect x="22" y="76" width="56" height="11" rx="3"/>';

// Shapes filled with the piece color, then details drawn in the outline color.
const SHAPES = {
  p: {
    body: '<path d="M38 76 C40 62 44 53 46 47 L54 47 C56 53 60 62 62 76 Z"/><circle cx="50" cy="35" r="12"/>',
    detail: '<rect x="40" y="45" width="20" height="5" rx="2"/>',
  },
  r: {
    body: '<path d="M32 76 L35 41 L65 41 L68 76 Z"/><path d="M28 41 L28 20 L37 20 L37 28 L45 28 L45 20 L55 20 L55 28 L63 28 L63 20 L72 20 L72 41 Z"/>',
    detail: '<rect x="33" y="40" width="34" height="5" rx="1"/>',
  },
  n: {
    body: '<path d="M32 76 C33 66 39 60 46 56 C39 56 31 58 27 54 C24 51 25 46 29 43 L45 30 L47 18 L55 26 C67 31 73 47 70 76 Z"/>',
    detail: '<circle cx="46" cy="37" r="3"/><path d="M56 30 C62 38 64 50 63 62" fill="none" stroke-width="4" stroke-linecap="round"/>',
  },
  b: {
    body: '<path d="M36 76 C34 60 38 42 50 23 C62 42 66 60 64 76 Z"/><circle cx="50" cy="17" r="6"/>',
    detail: '<path d="M56 33 L45 49" fill="none" stroke-width="5" stroke-linecap="round"/><rect x="37" y="60" width="26" height="5" rx="2"/>',
  },
  q: {
    body: '<path d="M30 76 L33 52 L25 31 L39 44 L38 23 L46 42 L50 19 L54 42 L62 23 L61 44 L75 31 L67 52 L70 76 Z"/>'
      + '<circle cx="25" cy="31" r="4.5"/><circle cx="38" cy="23" r="4.5"/><circle cx="50" cy="18" r="4.5"/><circle cx="62" cy="23" r="4.5"/><circle cx="75" cy="31" r="4.5"/>',
    detail: '<rect x="33" y="52" width="34" height="5" rx="2"/>',
  },
  k: {
    body: '<path d="M32 76 C32 61 36 47 40 41 L60 41 C64 47 68 61 68 76 Z"/><rect x="37" y="32" width="26" height="10" rx="3"/><rect x="46.5" y="10" width="7" height="23" rx="1"/><rect x="40" y="16" width="20" height="7" rx="1"/>',
    detail: '<rect x="35" y="56" width="30" height="5" rx="2"/>',
  },
};

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// SVG markup for one piece at the origin of a 100 x 100 box.
export function pieceSvg(type, color) {
  const shape = SHAPES[type];
  const side = color === 'w' ? 'white' : 'black';
  return `<g class="piece ${side}"><g class="fill">${BASE}${shape.body}</g><g class="detail">${shape.detail}</g></g>`;
}
