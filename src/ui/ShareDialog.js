import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { h, resizable } from './dom.js';
import { measureShare, decodeShare, isShareCode, QR_BYTE_LIMIT } from '../core/Share.js';

// ============================================================
//  Share : a build as a QR code, a text code, or a PNG.
//
//  Import accepts an image as well as text, because a code you can only
//  retype is not really shared. jsQR does the reading, so a photo of
//  someone else's screen works as well as the exported file.
// ============================================================

const QUIET = 4;          // modules of margin, per the spec's minimum
const MODULE = 6;         // on-screen pixels per module
const EXPORT_MODULE = 10; // pixels per module in the downloaded PNG

/** Draw a QR matrix onto a canvas, sized to the module count. */
export function drawQR(canvas, text, { module = MODULE, ecc = 'M' } = {}) {
  let qr = null;
  for (const level of [ecc, 'L']) {
    try {
      const q = qrcode(0, level);
      q.addData(text, 'Byte');
      q.make();
      qr = q;
      break;
    } catch {
      qr = null;
    }
  }
  if (!qr) throw new Error(`データが大きすぎて QR にできません（${text.length} / ${QR_BYTE_LIMIT} バイト）`);

  const n = qr.getModuleCount();
  const size = (n + QUIET * 2) * module;
  canvas.width = size;
  canvas.height = size;

  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        g.fillRect((c + QUIET) * module, (r + QUIET) * module, module, module);
      }
    }
  }
  return { modules: n, size };
}

/** Pull a code back out of any image. Returns the decoded text, or null. */
export async function readQRFromImage(source) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  // Very large photos slow jsQR down for no gain in accuracy.
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  return found?.data ?? null;
}

export class ShareDialog {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.open = false;
    this.code = '';

    this.canvas = h('canvas', {
      class: 'qrcanvas',
      title: 'クリックで拡大（スマホで読むときはこちら）',
      onClick: () => this._toggleZoom(),
    });
    this.titleEl = h('div', { class: 'sharetitle' }, '—');
    this.sizeEl = h('div', { class: 'note' }, '');
    this.codeEl = h('textarea', { class: 'sharecode', readonly: 'readonly', rows: 4 });
    this.noteEl = h('div', { class: 'keynote' }, '');

    this.importEl = h('textarea', {
      class: 'sharecode', rows: 3, placeholder: 'BRO1: で始まる共有コードを貼り付け',
    });

    this.fileInput = h('input', {
      type: 'file', accept: 'image/*', style: 'display:none',
      onChange: (e) => this._readFile(e.target.files?.[0]),
    });

    this.box = h('div', { class: 'keybox sharebox' },
        h('div', { class: 'keyhead' },
          h('div', { class: 'brand' }, 'SHARE', h('small', {}, 'QR CODE')),
          h('div', { class: 'spacer' }),
          h('button', { class: 'icon', title: '閉じる', onClick: () => this.close() }, '✕'),
        ),

        h('div', { class: 'sharebody' },
          h('div', { class: 'sharecol' },
            this.titleEl,
            this.canvas,
            this.sizeEl,
            h('div', { class: 'row tight' },
              h('button', { onClick: () => this._toggleZoom() }, '拡大'),
              h('button', { onClick: () => this._copy() }, 'コードをコピー'),
              h('button', { onClick: () => this._savePng() }, 'PNG保存'),
            ),
            h('div', { class: 'note' },
              'この密度の QR は小さく写すと読めません。スマホで読むなら［拡大］、',
              h('br'), 'ファイルで渡すなら［PNG保存］（縮小せずにそのまま送ってください）。'),
            this.codeEl,
          ),

          h('div', { class: 'sharecol' },
            h('h3', { class: 'inline' }, '読み込む'),
            h('div', { class: 'note' },
              'QR画像をここにドロップするか、コードを貼り付けてください。',
              h('br'), '機体は編集画面に、パーツはパーツ庫に入ります。'),
            h('div', {
              class: 'dropzone',
              onClick: () => this.fileInput.click(),
              onDragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); },
              onDragleave: (e) => e.currentTarget.classList.remove('over'),
              onDrop: (e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('over');
                this._readFile(e.dataTransfer?.files?.[0]);
              },
            }, 'QR画像をドロップ / クリックして選択'),
            this.importEl,
            h('button', { class: 'primary wide', onClick: () => this._importText() }, '読み込む'),
          ),
        ),

        this.noteEl,
        this.fileInput,
    );
    resizable(this.box, { key: 'sharedlg', edges: 'es', minW: 360, minH: 260, speed: 2 });
    this.el = h('div', { id: 'sharedlg', class: 'hidden' }, this.box);
  }

  // ---------------------------------------------------------- open / close

  async show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this._note('');
    await this.refresh();
    return this;
  }

  close() {
    this.open = false;
    this.el.classList.remove('zoom');
    this.el.classList.add('hidden');
    return this;
  }

  /**
   * Fill the screen with the code. A 129-module QR needs roughly six screen
   * pixels per module before a phone will read it — about 780px — which is
   * more than the dialog can give it.
   */
  _toggleZoom() {
    if (this.canvas.classList.contains('hidden')) return this;
    this.el.classList.toggle('zoom');
    this._note(this.el.classList.contains('zoom')
      ? 'スマホのカメラで読み取ってください。もう一度クリックで戻ります'
      : '');
    return this;
  }

  /** Re-read the document being edited and redraw its code. */
  async refresh() {
    const assembly = this.app.assembly;
    const info = await measureShare(assembly);
    this.code = info.code;
    this.titleEl.textContent = `${info.isPart ? 'パーツ' : '機体'}: ${info.name}`;
    this.codeEl.value = info.code;

    try {
      const { modules } = drawQR(this.canvas, info.code);
      this.sizeEl.textContent = `${info.bytes} バイト / QR ${modules}×${modules}`;
      this.canvas.classList.remove('hidden');
    } catch (e) {
      this.canvas.classList.add('hidden');
      this.sizeEl.textContent = `${info.bytes} バイト — ${e.message}。テキストコードは使えます。`;
    }
    return this;
  }

  // ---------------------------------------------------------- export

  async _copy() {
    try {
      await navigator.clipboard.writeText(this.code);
      this._note('共有コードをコピーしました');
    } catch {
      this.codeEl.select();
      this._note('コピーできませんでした。選択されているので Ctrl+C を押してください');
    }
  }

  _savePng() {
    if (this.canvas.classList.contains('hidden')) {
      this._note('QR にできないサイズです。テキストコードを使ってください');
      return;
    }
    // Redraw larger so the saved file is worth scanning from a screen.
    const big = document.createElement('canvas');
    drawQR(big, this.code, { module: EXPORT_MODULE });
    const a = document.createElement('a');
    a.href = big.toDataURL('image/png');
    a.download = `${(this.app.assembly.name || 'blostom').replace(/\s+/g, '_')}.qr.png`;
    a.click();
    this._note('PNG を保存しました');
  }

  // ---------------------------------------------------------- import

  async _readFile(file) {
    if (!file) return;
    this._note('画像を読み取っています…');
    try {
      const text = await readQRFromImage(file);
      if (!text) { this._note('画像から QR を読み取れませんでした'); return; }
      this.importEl.value = text;
      await this._import(text);
    } catch (e) {
      this._note(`画像を読めませんでした: ${e.message}`);
    }
  }

  _importText() { return this._import(this.importEl.value); }

  async _import(text) {
    const t = String(text ?? '').trim();
    if (!t) { this._note('コードが空です'); return; }
    if (!isShareCode(t)) { this._note('BLOSTOM の共有コードではありません'); return; }
    try {
      const assembly = await decodeShare(t);
      const where = this.app.adoptShared(assembly);
      this._note(`「${assembly.name}」を${where}に読み込みました`);
      await this.refresh();
    } catch (e) {
      this._note(e.message);
    }
  }

  _note(msg) { this.noteEl.textContent = msg; }
}
