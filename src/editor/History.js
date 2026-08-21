// ============================================================
//  Undo / redo.
//
//  Snapshot-based, not command-based: an assembly serialises to a compact
//  JSON document already (voxels are run-length encoded), and a whole-document
//  snapshot is immune to the class of bug where an inverse operation drifts
//  out of step with the forward one.
//
//  A snapshot is pushed BEFORE a change is applied, labelled with what that
//  change was about to do — so "undo" can say what it is undoing.
// ============================================================

const DEFAULT_LIMIT = 60;
/** Snapshots at 1/100 resolution are not small; keep a lid on the total. */
const DEFAULT_BYTES = 48 * 1024 * 1024;

export class History {
  constructor({ limit = DEFAULT_LIMIT, byteLimit = DEFAULT_BYTES } = {}) {
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.past = [];
    this.future = [];
    this.bytes = 0;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** What the next undo would reverse, for the tooltip. */
  get undoLabel() { return this.past.length ? this.past[this.past.length - 1].label : null; }
  get redoLabel() { return this.future.length ? this.future[this.future.length - 1].label : null; }

  clear() {
    this.past.length = 0;
    this.future.length = 0;
    this.bytes = 0;
  }

  /**
   * Record the state as it was before `label` happened.
   * Doing anything new invalidates the redo branch, as it must.
   */
  push(label, snapshot) {
    this.past.push({ label, snapshot });
    this.bytes += snapshot.length;
    for (const e of this.future) this.bytes -= e.snapshot.length;
    this.future.length = 0;
    this._trim();
    return this;
  }

  /** @returns {{label:string, snapshot:string}|null} */
  undo(current) {
    const entry = this.past.pop();
    if (!entry) return null;
    this.bytes -= entry.snapshot.length;
    this.future.push({ label: entry.label, snapshot: current });
    this.bytes += current.length;
    this._trim();
    return entry;
  }

  /** @returns {{label:string, snapshot:string}|null} */
  redo(current) {
    const entry = this.future.pop();
    if (!entry) return null;
    this.bytes -= entry.snapshot.length;
    this.past.push({ label: entry.label, snapshot: current });
    this.bytes += current.length;
    this._trim();
    return entry;
  }

  /** Drop the oldest history until we are back inside both limits. */
  _trim() {
    while (this.past.length > this.limit
      || (this.bytes > this.byteLimit && this.past.length > 1)) {
      const dropped = this.past.shift();
      if (!dropped) break;
      this.bytes -= dropped.snapshot.length;
    }
  }
}
