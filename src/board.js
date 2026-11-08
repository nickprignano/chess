// The board: an SVG drawn from the game's position. Tap a piece then a square, drag a piece,
// or use the arrow keys and Enter. It knows nothing about the rules: it asks `targets(square)`
// where a piece may go and reports moves through `onMove(from, to)`.

import { PIECE_NAMES, pieceSvg } from './pieces.js';

const FILES = 'abcdefgh';
const DRAG_START_PX = 6;

// Square name for a column and row on screen (0-7, top-left first).
export function squareAt(col, row, orientation) {
  return orientation === 'w' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
}

// Screen column and row for a square name.
export function cellOf(square, orientation) {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]) - 1;
  return orientation === 'w' ? [f, 7 - r] : [7 - f, r];
}

export class Board {
  constructor(svg, { targets, onMove }) {
    this.svg = svg;
    this.targetsOf = targets;
    this.onMove = onMove;
    this.state = { board: [], orientation: 'w', lastMove: null, check: null, locked: false };
    this.selected = null;
    this.targets = [];
    this.cursor = 'e2';
    this.drag = null;
    this.keyboard = false; // the cursor square shows only after a key press
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('role', 'application');
    svg.setAttribute('tabindex', '0');
    svg.addEventListener('pointerdown', (e) => this.pointerDown(e));
    svg.addEventListener('pointermove', (e) => this.pointerMove(e));
    svg.addEventListener('pointerup', (e) => this.pointerUp(e));
    svg.addEventListener('pointercancel', () => this.cancelDrag());
    svg.addEventListener('keydown', (e) => this.keyDown(e));
    svg.addEventListener('focus', () => this.render());
    svg.addEventListener('blur', () => this.render());
  }

  set(state) {
    this.state = { ...this.state, ...state };
    this.clearSelection();
  }

  clearSelection() {
    this.selected = null;
    this.targets = [];
    this.render();
  }

  pieceOn(square) {
    const [col, row] = cellOf(square, 'w');
    return this.state.board[row]?.[col] ?? null;
  }

  // Taps and Enter both come here.
  activate(square) {
    if (this.state.locked) return;
    if (this.selected && this.targets.includes(square)) {
      const from = this.selected;
      this.clearSelection();
      this.onMove(from, square);
      return;
    }
    const targets = square === this.selected ? [] : this.targetsOf(square);
    this.selected = targets.length ? square : null;
    this.targets = targets;
    this.render();
  }

  squareFromEvent(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    const col = Math.floor(p.x / 100);
    const row = Math.floor(p.y / 100);
    if (col < 0 || col > 7 || row < 0 || row > 7) return { square: null, x: p.x, y: p.y };
    return { square: squareAt(col, row, this.state.orientation), x: p.x, y: p.y };
  }

  pointerDown(e) {
    if (e.button !== 0 || this.state.locked) return;
    this.keyboard = false;
    const { square } = this.squareFromEvent(e);
    if (!square) return;
    this.cursor = square;
    const wasSelected = this.selected;
    this.activate(square);
    // A press on a piece that can move may turn into a drag.
    if (this.selected === square) {
      this.drag = { from: square, startX: e.clientX, startY: e.clientY, moving: false, wasSelected };
      this.svg.setPointerCapture(e.pointerId);
    }
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moving && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
    d.moving = true;
    const { x, y } = this.squareFromEvent(e);
    const ghost = this.svg.querySelector('.ghost');
    if (ghost) ghost.setAttribute('transform', `translate(${x - 55} ${y - 60}) scale(1.1)`);
    else this.render(x, y);
  }

  pointerUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.moving) {
      // A second tap on the selected piece puts it down.
      if (d.wasSelected === d.from) this.clearSelection();
      return;
    }
    const { square } = this.squareFromEvent(e);
    if (square && this.targets.includes(square)) {
      const from = this.selected;
      this.clearSelection();
      this.onMove(from, square);
    } else {
      this.clearSelection();
    }
  }

  cancelDrag() {
    this.drag = null;
    this.render();
  }

  keyDown(e) {
    this.keyboard = true;
    const steps = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const o = this.state.orientation;
    if (steps[e.key]) {
      const [col, row] = cellOf(this.cursor, o);
      const [dc, dr] = steps[e.key];
      this.cursor = squareAt(Math.min(7, Math.max(0, col + dc)), Math.min(7, Math.max(0, row + dr)), o);
      this.render();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      this.activate(this.cursor);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.clearSelection();
    }
  }

  // Redraws everything. While dragging, (dragX, dragY) is where the lifted piece goes.
  render(dragX, dragY) {
    const { orientation: o, lastMove, check } = this.state;
    const dragging = this.drag?.moving;
    const parts = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = squareAt(col, row, o);
        const light = (col + row) % 2 === 0;
        const x = col * 100;
        const y = row * 100;
        let cls = light ? 'sq light' : 'sq dark';
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cls += ' last';
        if (sq === this.selected) cls += ' selected';
        if (sq === check) cls += ' check';
        parts.push(`<rect class="${cls}" x="${x}" y="${y}" width="100" height="100"/>`);
        // Coordinates along the bottom and left edges.
        if (row === 7) parts.push(`<text class="coord ${light ? 'on-light' : 'on-dark'}" x="${x + 92}" y="${y + 94}" text-anchor="end">${sq[0]}</text>`);
        if (col === 0) parts.push(`<text class="coord ${light ? 'on-light' : 'on-dark'}" x="${x + 6}" y="${y + 22}">${sq[1]}</text>`);
      }
    }
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = squareAt(col, row, o);
        const p = this.pieceOn(sq);
        if (!p || (dragging && sq === this.selected)) continue;
        parts.push(`<g transform="translate(${col * 100} ${row * 100})">${pieceSvg(p.type, p.color)}</g>`);
      }
    }
    for (const t of this.targets) {
      const [col, row] = cellOf(t, o);
      const occupied = this.pieceOn(t);
      parts.push(occupied
        ? `<circle class="target capture" cx="${col * 100 + 50}" cy="${row * 100 + 50}" r="45"/>`
        : `<circle class="target" cx="${col * 100 + 50}" cy="${row * 100 + 50}" r="15"/>`);
    }
    if (this.keyboard && document.activeElement === this.svg) {
      const [col, row] = cellOf(this.cursor, o);
      parts.push(`<rect class="cursor" x="${col * 100 + 4}" y="${row * 100 + 4}" width="92" height="92" rx="6"/>`);
    }
    if (dragging && this.selected && dragX !== undefined) {
      const p = this.pieceOn(this.selected);
      parts.push(`<g class="ghost" transform="translate(${dragX - 55} ${dragY - 60}) scale(1.1)">${pieceSvg(p.type, p.color)}</g>`);
    }
    this.svg.innerHTML = parts.join('');
    this.svg.setAttribute('aria-label', this.describe());
  }

  // What a screen reader hears: the square under the cursor and what's selected.
  describe() {
    const p = this.pieceOn(this.cursor);
    const on = p ? `${p.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[p.type]}` : 'empty';
    const sel = this.selected ? `, ${this.selected} selected` : '';
    return `Chess board. ${this.cursor}: ${on}${sel}. Arrow keys move, Enter picks up and puts down.`;
  }
}
