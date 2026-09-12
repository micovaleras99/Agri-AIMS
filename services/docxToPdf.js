/**
 * Convert a .docx to .pdf using the Microsoft Word that is installed on this
 * machine, driven through PowerShell COM automation. Word renders the document
 * exactly as it would on screen, so the official form's layout, fonts, tables and
 * logos are preserved in the PDF — which a pure-JS converter cannot guarantee.
 *
 * ponytail: one Word process is launched per conversion (a few seconds each).
 * Fine for the low volume here; if generation ever becomes hot, batch conversions
 * through a single long-lived Word instance instead.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

const WORD_TIMEOUT_MS = 90000;
const WD_FORMAT_PDF = 17; // wdExportFormatPDF

/**
 * Convert `inAbs` (an absolute .docx path) to `outAbs` (absolute .pdf path).
 * Throws if Word is unavailable or the conversion fails; callers decide whether
 * to fall back to serving the .docx.
 *
 * @param {string} inAbs   absolute path to the source .docx
 * @param {string} outAbs  absolute path for the output .pdf
 * @returns {string} outAbs
 */
function convert(inAbs, outAbs) {
  // Single-quoted PowerShell strings take the paths literally (backslashes and
  // all); our paths are random hex names under uploads/, so they carry no quotes.
  const script = [
    "$ErrorActionPreference='Stop'",
    '$word = New-Object -ComObject Word.Application',
    '$word.Visible = $false',
    'try {',
    `  $doc = $word.Documents.Open('${inAbs}', $false, $true)`,
    `  $doc.ExportAsFixedFormat('${outAbs}', ${WD_FORMAT_PDF})`,
    '  $doc.Close($false)',
    '} finally {',
    '  $word.Quit()',
    '}',
  ].join('; ');

  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: WORD_TIMEOUT_MS, stdio: 'pipe' });

  if (!fs.existsSync(outAbs)) throw new Error('docxToPdf: Word produced no PDF');
  return outAbs;
}

module.exports = { convert };

// ponytail: self-check converts the real template — run `node services/docxToPdf.js`.
// (Launches Word; a few seconds. Skipped in normal test runs.)
if (require.main === module) {
  const assert = require('assert');
  const os = require('os');
  const path = require('path');
  const src = path.join(__dirname, '..', 'forms', 'prescribed', 'self-assessment.docx');
  const out = path.join(os.tmpdir(), `sa-convert-${Date.now()}.pdf`);
  convert(src, out);
  const head = fs.readFileSync(out).subarray(0, 5).toString('latin1');
  assert.ok(head.startsWith('%PDF'), `output is a PDF (got ${JSON.stringify(head)})`);
  fs.unlinkSync(out);
  console.log('docxToPdf self-check passed');
}
