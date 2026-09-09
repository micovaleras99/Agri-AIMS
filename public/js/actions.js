/**
 * Delegated replacement for inline on* handler attributes.
 *
 * The CSP forbids script-src-attr ('none'), so `onclick="…"` and friends no
 * longer run. Markup opts into behaviour declaratively instead, and this one
 * script — loaded on every page — dispatches it:
 *
 *   data-call="fnName"                 a global function to invoke
 *   data-on="click|input|change|submit|keypress"   which event (default click)
 *   data-args='["literal", "@this", "@event"]'      optional; @this / @event
 *                                                   are replaced at call time
 *
 * If the called function returns exactly false, the event's default action is
 * prevented (mirrors the old `onclick="return foo()"`).
 *
 * A form, link or button may also carry:
 *
 *   data-confirm="Are you sure?"       asks first; cancels the action if the
 *                                      user declines (replaces
 *                                      `onsubmit="return confirm(…)"`).
 *
 * Everything is event delegation on `document`, so it also covers markup added
 * after load.
 */
(function () {
  function invoke(el, e) {
    var name = el.getAttribute('data-call');
    var fn = name && window[name];
    if (typeof fn !== 'function') return;
    var args = [];
    var raw = el.getAttribute('data-args');
    if (raw) {
      try {
        args = JSON.parse(raw).map(function (a) {
          if (a === '@event') return e;
          if (a === '@this') return el;
          return a;
        });
      } catch (err) { args = []; }
    }
    if (fn.apply(el, args) === false) e.preventDefault();
  }

  function onEvent(e) {
    if (!e.target || !e.target.closest) return;

    // Confirmation guard runs before anything else on click/submit.
    if (e.type === 'click' || e.type === 'submit') {
      var guard = e.target.closest('[data-confirm]');
      if (guard) {
        if (!window.confirm(guard.getAttribute('data-confirm'))) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    var el = e.target.closest('[data-call]');
    if (el && (el.getAttribute('data-on') || 'click') === e.type) invoke(el, e);
  }

  ['click', 'input', 'change', 'submit', 'keypress'].forEach(function (type) {
    document.addEventListener(type, onEvent, false);
  });
}());
