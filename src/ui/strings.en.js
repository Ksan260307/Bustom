// ============================================================
//  English, assembled from one file per area.
//
//  Split because a thousand entries in one object is a file nobody opens
//  twice, and because the areas have genuinely different problems: the
//  workbench is fighting for panel width, the help screen is prose, and
//  the data tables are nouns that appear in both.
//
//  Keys are the Japanese source strings, exactly as they appear in `src` —
//  see i18n.js for why. A missing entry renders as Japanese rather than as
//  a broken key, and `node tools/check-i18n.mjs` lists what is missing.
// ============================================================

import { CORE } from './strings/en.core.js';
import { EDITOR } from './strings/en.editor.js';
import { EDITOR2 } from './strings/en.editor2.js';
import { HELP } from './strings/en.help.js';
import { OPTIONS } from './strings/en.options.js';
import { SCREENS } from './strings/en.screens.js';
import { TABLES } from './strings/en.tables.js';

export const EN = {
  ...TABLES, ...CORE, ...EDITOR, ...EDITOR2, ...SCREENS, ...HELP, ...OPTIONS,
};
