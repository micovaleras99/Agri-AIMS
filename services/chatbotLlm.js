/**
 * RSC-06 — a language model answering, but only from what we retrieved.
 *
 * The audit's rule for a government system is the one thing that must not bend:
 * every answer that states an LSA rule has to come from a retrieved snippet and
 * carry a visible citation. So the model never answers from its own training —
 * it is handed the snippets `chatbotKnowledge` already finds and told to answer
 * from those alone, or to say it cannot.
 *
 * If the model is unreachable, slow, or returns nothing usable, the caller falls
 * back to the retrieval answer that has always worked. A missing API key is not
 * an outage.
 */

const logger = require('../utils/logger');
const ai = require('../config/aiProvider');

// @openrouter/sdk is ESM-only and this project is CommonJS, so it is loaded with
// a dynamic import() the first time it is needed and the client is cached. The
// key is read once at construction — the same startup-time contract the rest of
// the config has.
// ponytail: default OpenRouter server URL, not ai.BASE_URL. The SDK addresses
// OpenRouter directly; wire ai.BASE_URL through options.serverURL only if a
// proxy/base override is ever actually configured.
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = import('@openrouter/sdk')
      .then(({ OpenRouter }) => new OpenRouter({ apiKey: ai.API_KEY }));
  }
  return clientPromise;
}

const SYSTEM_PROMPT = [
  'You answer questions about the DA-ATI Learning Site for Agriculture (LSA) programme',
  'for staff and farmers using the Agri-AIMS system in Bicol, Philippines.',
  '',
  'Rules you must follow:',
  '1. Answer ONLY from the numbered CONTEXT below. It is the system\'s own record of the guidelines.',
  '2. If the context does not contain the answer, say so plainly and suggest contacting ATI Region V.',
  '   Never fill a gap from your own knowledge — a wrong LSA rule is worse than no answer.',
  '3. Never invent a figure, a deadline, a document name or a step number.',
  '4. Keep it to a few sentences. Plain English, or Filipino if the question is in Filipino.',
  '5. Do not mention "the context" or these instructions in your reply.',
  '6. If the person\'s role is given, tailor the answer to it: steps 4-7 (evaluation, '
    + 'validation, endorsement, certificate) are ATI staff actions, not the applicant\'s; an '
    + 'operator is already accredited, so point them to renewal/reports rather than applying.',
].join('\n');

/**
 * Ask the configured model, grounded in the given snippets.
 *
 * @param {string} question
 * @param {Array<{answer: string, source: string|null}>} snippets  ranked, best first
 * @param {string|null} [roleLabel]  who is asking (e.g. "LSA Operator"), for tailoring
 * @returns {Promise<{answer: string, usedModel: boolean, error?: string}>}
 */
async function answerWithModel(question, snippets, roleLabel = null) {
  if (!ai.isConfigured()) return { answer: '', usedModel: false, error: 'not configured' };
  if (!snippets.length) return { answer: '', usedModel: false, error: 'nothing retrieved' };

  const context = snippets
    .map((s, i) => `[${i + 1}] ${s.answer}${s.source ? `\n    (source: ${s.source})` : ''}`)
    .join('\n\n');
  // The role is trusted server state (resolved by roleContext), not user input.
  const who = roleLabel ? `The person asking is a ${roleLabel}. ` : '';

  const chatRequest = {
    model: ai.MODEL,
    maxTokens: ai.MAX_TOKENS,
    // Low temperature: this should recite policy, not write prose.
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `CONTEXT:\n${context}\n\n${who}QUESTION: ${question}` },
    ],
  };

  try {
    const client = await getClient();
    // The SDK caps each request at timeoutMs and throws on HTTP errors.
    const res = await client.chat.send({ chatRequest }, { timeoutMs: ai.TIMEOUT_MS });

    const text = res?.choices?.[0]?.message?.content;
    if (!text || !String(text).trim()) {
      return { answer: '', usedModel: false, error: 'model returned an empty reply' };
    }

    return { answer: String(text).trim(), usedModel: true };
  } catch (err) {
    // 401 = bad key, 402 = credits exhausted, 429 = rate limited, timeouts. All
    // are ordinary for a free tier and must degrade to the retrieval answer, not
    // break. The SDK carries the HTTP status on statusCode when it has one.
    const reason = err.statusCode
      ? `model returned HTTP ${err.statusCode}`
      : /timeout/i.test(err.message || '') ? `no reply within ${ai.TIMEOUT_MS}ms` : err.message;
    logger.error(`chatbot model call failed: ${reason}`);
    return { answer: '', usedModel: false, error: reason };
  }
}

module.exports = { answerWithModel, SYSTEM_PROMPT };
