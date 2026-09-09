/**
 * Turning what someone typed into a safe SQL LIKE pattern.
 *
 * The queries were already parameterised, so this was never an injection
 * risk — but `%` and `_` are wildcards *inside* a LIKE pattern regardless of
 * how the value arrived. Searching for "100%" matched every row, and a search
 * for "_" matched everything too. Escaping them makes a search for a literal
 * per-cent sign mean a per-cent sign.
 *
 * MySQL treats backslash as the escape character inside LIKE by default, so
 * the backslash itself has to be escaped first or it would consume whatever
 * followed.
 */

/**
 * @param {string} input what the user typed
 * @returns {string} a pattern for `LIKE ?`, matching the term anywhere
 */
function likeTerm(input) {
  const escaped = String(input == null ? '' : input)
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

module.exports = { likeTerm };
