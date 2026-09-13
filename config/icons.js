/**
 * Bootstrap-Icons name -> Phosphor classes, for icons chosen dynamically at
 * render time (config/route data still stores the familiar Bootstrap names, e.g.
 * ACCREDITATION_STEPS `icon: 'clipboard-check'`). Views call `ic(name)` instead
 * of hardcoding a class, so a data-driven icon becomes the right Phosphor class
 * without touching every config value.
 *
 * `ic()` also accepts a trailing utility class ("check-circle text-success") and
 * a Bootstrap `-fill` suffix, which maps to Phosphor's fill weight.
 */

// Bootstrap base name -> Phosphor base name (only where they differ). Names not
// listed are assumed identical in Phosphor (validated in the self-check).
const ALIAS = {
  'arrow-left-right': 'arrows-left-right', 'arrow-repeat': 'arrows-clockwise',
  'arrow-return-left': 'arrow-bend-up-left', 'arrow-return-right': 'arrow-bend-up-right',
  'arrow-right-circle': 'arrow-circle-right', 'arrow-right-short': 'arrow-right',
  'arrow-up-circle': 'arrow-circle-up', 'box-arrow-up-right': 'arrow-square-out',
  'box-arrow-in-right': 'sign-in', 'box-arrow-right': 'sign-out',
  award: 'medal', 'bar-chart': 'chart-bar', 'bar-chart-line': 'chart-bar', 'bar-chart-steps': 'chart-bar',
  'calendar-event': 'calendar-dots', 'calendar-week': 'calendar', calendar3: 'calendar-blank', 'calendar3-range': 'calendar-blank',
  'card-list': 'list-bullets', 'camera-video': 'video-camera', 'chat-square-text': 'chat-text', 'chat-dots': 'chat-circle-dots',
  'check-lg': 'check', check2: 'check', 'check2-circle': 'check-circle', 'check2-square': 'check-square',
  'chevron-right': 'caret-right', 'clipboard-check': 'clipboard-text', 'clipboard-data': 'clipboard-text', 'clipboard2-check': 'clipboard-text',
  'clock-history': 'clock-counter-clockwise', 'cloud-upload': 'cloud-arrow-up', collection: 'stack',
  'dash-circle': 'minus-circle', 'dash-lg': 'minus', 'diagram-3': 'tree-structure', 'envelope-paper': 'envelope',
  'exclamation-circle': 'warning-circle', 'exclamation-triangle': 'warning',
  'file-bar-graph': 'file-text', 'file-earmark': 'file',
  'file-earmark-arrow-down': 'file-arrow-down', 'file-earmark-arrow-up': 'file-arrow-up',
  'file-earmark-check': 'file-text', 'file-earmark-pdf': 'file-pdf', 'file-earmark-plus': 'file-plus',
  'file-earmark-text': 'file-text', 'file-earmark-word': 'file-doc', 'file-earmark-zip': 'file-zip',
  'filetype-csv': 'file-csv', 'filetype-json': 'file-code', 'filetype-xml': 'file-code',
  flower1: 'flower', floppy: 'floppy-disk', 'folder-check': 'folder', 'folder-x': 'folder-minus', 'folder2-open': 'folder-open',
  'folder-plus': 'folder-simple-plus', 'geo-alt': 'map-pin', 'graph-up': 'chart-line-up', 'grid-3x3-gap': 'squares-four',
  'hourglass-split': 'hourglass', 'house-door': 'house', inbox: 'tray', 'info-circle': 'info',
  'journal-plus': 'notebook', 'journal-text': 'notebook', 'lightning-charge': 'lightning', 'list-check': 'list-checks',
  magic: 'magic-wand', map: 'map-trifold', mortarboard: 'graduation-cap',
  'patch-check': 'seal-check', 'pencil-square': 'pencil-simple-line', pencil: 'pencil-simple',
  people: 'users', 'person-badge': 'identification-badge', 'person-check': 'user-check',
  'person-fill-add': 'user-plus', 'person-plus': 'user-plus', 'person-vcard': 'identification-card', person: 'user',
  'pie-chart': 'chart-pie', 'pin-map': 'map-pin', 'plus-lg': 'plus', 'question-circle': 'question',
  rulers: 'ruler', save: 'floppy-disk', search: 'magnifying-glass',
  send: 'paper-plane-right', 'send-check': 'paper-plane-right',
  'shield-exclamation': 'shield-warning', 'shield-lock': 'shield', 'shield-check': 'shield-check', 'signpost-split': 'signpost',
  'slash-circle': 'prohibit', speedometer2: 'gauge', tags: 'tag',
  'x-lg': 'x', 'x-octagon': 'x-square',
};

/**
 * @param {string} name  a Bootstrap icon name, optionally with a trailing class
 *   (e.g. "check-circle text-success"); "" / falsy yields an empty string.
 * @returns {string} Phosphor classes, e.g. "ph ph-check-circle text-success".
 */
function ic(name) {
  if (!name) return '';
  const [icon, ...rest] = String(name).trim().split(/\s+/);
  let fill = false;
  let base = icon;
  if (base.endsWith('-fill')) { fill = true; base = base.slice(0, -5); }
  const ph = ALIAS[base] || base;
  const cls = `${fill ? 'ph-fill' : 'ph'} ph-${ph}`;
  return rest.length ? `${cls} ${rest.join(' ')}` : cls;
}

module.exports = { ic, ALIAS };
