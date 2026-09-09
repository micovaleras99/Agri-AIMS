/**
 * JSON for embedding inside an HTML <script> tag.
 *
 * `JSON.stringify` alone is unsafe there: it does not escape `</script>` or
 * `<!--`, so any user-controlled string (a chat message, a farm name) that
 * contains `</script>` closes the tag early and injects markup — stored XSS.
 * Escaping `<`, `>` and `&` to their \uXXXX forms keeps the output valid JSON
 * (so JSON.parse still works) and valid JS, while making a tag breakout
 * impossible. U+2028/U+2029 are escaped too: they are legal in JSON but are
 * line terminators in a JS string literal and would break an inline script.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp('\\u2028', 'g'), '\\u2028')
    .replace(new RegExp('\\u2029', 'g'), '\\u2029');
}

module.exports = { safeJson };
