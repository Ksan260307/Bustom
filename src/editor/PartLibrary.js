import { Assembly } from '../core/Assembly.js';

// ============================================================
//  A shelf of saved parts.
//
//  Each entry is a complete assembly document rooted at a block, so a "part"
//  can be anything from one carved cube to a whole articulated limb. Grafting
//  one into a machine goes through Assembly.graft, which regenerates ids and
//  merges the palette — the same path copy/paste uses.
// ============================================================

const KEY = 'blostom.parts.v1';
/**
 * What the store was called before the game was renamed.
 *
 * Read as a fallback and never written. A rebranding is not a reason for
 * anyone to lose the parts they saved.
 */
const KEY_WAS = 'brostom.parts.v1';

let _seq = 0;
const nextId = () => `pl${Date.now().toString(36)}${(_seq++).toString(36)}`;

export class PartLibrary {
  /** @param {Storage|null} storage injectable so tests do not touch the real one */
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.items = [];
    /** Which batch of starter parts has already been offered. */
    this.seeded = 0;
    this.load();
  }

  load() {
    this.items = [];
    if (!this.storage) return this;
    try {
      const raw = this.storage.getItem(KEY) ?? this.storage.getItem(KEY_WAS);
      if (!raw) return this;
      const data = JSON.parse(raw);
      if (Array.isArray(data?.items)) this.items = data.items;
      // Which batch of starter parts this shelf has already been offered.
      // Without it, deleting one would put it back on the next launch.
      this.seeded = Number(data?.seeded) || 0;
    } catch (e) {
      console.warn('part library could not be read', e);
    }
    return this;
  }

  save() {
    if (!this.storage) return false;
    try {
      this.storage.setItem(KEY, JSON.stringify({
        version: 1, seeded: this.seeded, items: this.items,
      }));
      return true;
    } catch (e) {
      // Quota is the realistic failure here, and silently losing a part the
      // player just authored would be worse than saying so.
      console.warn('part library could not be written', e);
      return false;
    }
  }

  get size() { return this.items.length; }

  list() {
    return this.items.map(({ id, name, updatedAt, builtin, json }) => ({
      id, name, updatedAt, builtin: !!builtin, json,
    }));
  }

  /**
   * Put a batch of starter parts on the shelf, once.
   *
   * A new shelf was empty, and the only way onto it was to have already
   * built something worth saving — so the feature was invisible to exactly
   * the people it would have helped most. These are whole limbs lifted off
   * the built-in machines: something to hang on a core and then cut about.
   *
   * @param {number} batch bumped when the starter set changes
   * @param {Array<{name:string, json:object}>} parts
   */
  seed(batch, parts) {
    if (this.seeded >= batch) return 0;
    this.seeded = batch;
    let added = 0;
    for (const { name, json } of parts) {
      if (this.find(name)) continue;
      this.items.push({
        id: nextId(), name, json: { ...json, name }, updatedAt: Date.now(), builtin: true,
      });
      added++;
    }
    this.save();
    return added;
  }
  get(id) { return this.items.find((i) => i.id === id) ?? null; }
  find(name) { return this.items.find((i) => i.name === name) ?? null; }

  /**
   * Store a part document. Saving under an existing name overwrites it,
   * which is what "save" means once you have named something.
   * @returns {{id:string, name:string}} the stored entry
   */
  put(name, assembly) {
    const clean = String(name || '').trim() || 'PART';
    const json = assembly.toJSON();
    json.name = clean;

    const existing = this.find(clean);
    if (existing) {
      existing.json = json;
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }

    const entry = { id: nextId(), name: clean, json, updatedAt: Date.now() };
    this.items.push(entry);
    this.save();
    return entry;
  }

  /** @returns {Assembly|null} a fresh document, safe to edit */
  open(id) {
    const entry = this.get(id);
    if (!entry) return null;
    return Assembly.fromJSON(JSON.parse(JSON.stringify(entry.json)));
  }

  rename(id, name) {
    const entry = this.get(id);
    const clean = String(name || '').trim();
    if (!entry || !clean) return false;
    entry.name = clean;
    entry.json.name = clean;
    entry.updatedAt = Date.now();
    this.save();
    return true;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  clear() {
    this.items = [];
    this.save();
    return this;
  }
}
