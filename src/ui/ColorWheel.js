import { hsvToRgb, rgbToHsv, rgbToHex, hexToRgb, hexToCss, cssToHex } from '../core/Palette.js';

// ============================================================
//  HSV colour wheel: hue around the rim, saturation toward the centre,
//  value on the slider beside it. Plus a hex field, because sometimes
//  you already know the number you want.
// ============================================================

const SIZE = 148;

export class ColorWheel {
  /** @param {(hex:number)=>void} onPick fired continuously while dragging */
  constructor(onPick) {
    this.onPick = onPick;
    this.h = 205;
    this.s = 0.65;
    this.v = 0.9;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.canvas.className = 'wheel';
    this.ctx = this.canvas.getContext('2d');

    this.valueInput = document.createElement('input');
    this.valueInput.type = 'range';
    this.valueInput.min = '0';
    this.valueInput.max = '100';
    this.valueInput.value = String(Math.round(this.v * 100));
    this.valueInput.className = 'wheel-value';

    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'wheel-hex';
    this.hexInput.spellcheck = false;

    this.preview = document.createElement('div');
    this.preview.className = 'wheel-preview';

    this.el = document.createElement('div');
    this.el.className = 'wheelbox';
    const row = document.createElement('div');
    row.className = 'wheel-row';
    row.append(this.preview, this.hexInput);
    this.el.append(this.canvas, this.valueInput, row);

    this._bind();
    this.redraw();
    this._sync(false);
  }

  _bind() {
    let dragging = false;

    const pick = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * SIZE - SIZE / 2;
      const y = ((e.clientY - r.top) / r.height) * SIZE - SIZE / 2;
      const radius = SIZE / 2 - 2;
      const d = Math.min(Math.hypot(x, y), radius);
      this.h = (Math.atan2(y, x) * 180) / Math.PI;
      if (this.h < 0) this.h += 360;
      this.s = d / radius;
      this._sync(true);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    this.canvas.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
    this.canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    });

    this.valueInput.addEventListener('input', () => {
      this.v = Number(this.valueInput.value) / 100;
      this.redraw();
      this._sync(true);
    });

    this.hexInput.addEventListener('change', () => {
      const hex = cssToHex(this.hexInput.value);
      if (hex === null) { this._sync(false); return; }
      this.setHex(hex);
      this._sync(true);
    });
  }

  get hex() {
    const { r, g, b } = hsvToRgb(this.h, this.s, this.v);
    return rgbToHex(r, g, b);
  }

  setHex(hex) {
    const { r, g, b } = hexToRgb(hex);
    const hsv = rgbToHsv(r, g, b);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;
    this.valueInput.value = String(Math.round(this.v * 100));
    this.redraw();
    this._sync(false);
    return this;
  }

  _sync(emit) {
    const hex = this.hex;
    this.preview.style.background = hexToCss(hex);
    if (document.activeElement !== this.hexInput) this.hexInput.value = hexToCss(hex);
    this.drawCursor();
    if (emit) this.onPick(hex);
  }

  redraw() {
    const ctx = this.ctx;
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    const c = SIZE / 2;
    const radius = c - 2;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - c;
        const dy = y - c;
        const d = Math.hypot(dx, dy);
        const i = (y * SIZE + x) * 4;
        if (d > radius) { data[i + 3] = 0; continue; }
        let h = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (h < 0) h += 360;
        const { r, g, b } = hsvToRgb(h, d / radius, this.v);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
        // feather the rim so it does not alias into a cog
        data[i + 3] = d > radius - 1 ? 255 * (radius - d) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this._wheelImage = ctx.getImageData(0, 0, SIZE, SIZE);
    this.drawCursor();
  }

  drawCursor() {
    if (!this._wheelImage) return;
    const ctx = this.ctx;
    ctx.putImageData(this._wheelImage, 0, 0);
    const c = SIZE / 2;
    const radius = c - 2;
    const a = (this.h * Math.PI) / 180;
    const x = c + Math.cos(a) * this.s * radius;
    const y = c + Math.sin(a) * this.s * radius;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = this.v > 0.55 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
