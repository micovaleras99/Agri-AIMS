const express = require('express');
const { answer, allEntries } = require('../../services/chatbotKnowledge');
const { answerWithModel } = require('../../services/chatbotLlm');
const ai = require('../../config/aiProvider');

const router = express.Router();

// Greetings and thanks are not questions the knowledge base can answer: the
// keyword scorer drops words this short and finds nothing, so a plain "hi" used
// to get the cold "not found" fallback. Answer them directly. Anchored to the
// whole message, so "hello, what documents do I need?" still goes to the real
// answer path rather than being swallowed as a greeting. English + Filipino.
const SMALL_TALK = /^\s*(hi|hello+|hey+|yo|hiya|good\s*(morning|afternoon|evening|day)|kumusta|kamusta|magandang\s+(umaga|hapon|gabi|araw)|salamat|thank\s*you|thanks|maraming\s+salamat)(\s+(po|there|agribot|bot))?[\s!.,?]*$/i;
const SMALL_TALK_REPLY = "Hello! I'm AgriBot, the LSA assistant. Ask me about the "
  + 'accreditation steps, farm and operator requirements, documents, field validation, '
  + 'renewal, reports, or how to use Agri-AIMS.';

// "Who am I / what is my role / am I an admin" — answered from the signed-in
// account, never from the knowledge base. Anchored so a real question that
// merely contains "role" (e.g. "what are the roles in the system?") is not
// caught: those go to the normal answer path.
const IDENTITY = /^\s*(who\s*am\s*i|who\s*is\s*(the\s*)?(current\s*)?user|what('?s| is)\s*my\s*(role|account|name)|what\s*am\s*i|am\s*i\s*(an?\s*)?(admin|administrator|operator|applicant|evaluator|staff|user))\b/i;

const ROLE_LABEL = {
  admin: 'Administrator',
  evaluator: 'ATI Evaluator (staff)',
  operator: 'LSA Operator',
  applicant: 'Applicant',
};
const ROLE_CAN = {
  admin: 'As an administrator you can do everything in Agri-AIMS, including issuing certificates.',
  evaluator: 'As an ATI evaluator you handle document evaluation, field validation and endorsement.',
  operator: 'As an LSA operator you manage your own Learning Site — reports, compliance and renewal.',
  applicant: 'As an applicant you can track your own application and submit documents.',
};

function identityReply(role, user) {
  if (!user) {
    return "You are not signed in, so I can't tell who you are. Sign in from the home "
      + "page and I'll know your account and role.";
  }
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
  const can = ROLE_CAN[role] ? ` ${ROLE_CAN[role]}` : '';
  return `You are signed in as ${name}, and your role is ${ROLE_LABEL[role] || 'Guest'}.${can}`;
}

/**
 * GET /api/chatbot?q=... — answer a question about the LSA programme.
 *
 * A GET because it only reads reference data and changes nothing; that also
 * keeps it clear of CSRF, which guards state-changing verbs. Public, like the
 * widget itself — it exposes no applicant or farm rows.
 *
 * Two ways to answer, in order:
 *   1. If a model is configured, the whole (small) LSA corpus is handed to it
 *      and it replies from those entries alone (services/chatbotLlm.js), citing
 *      the numbered entry it used so the source stays ours.
 *   2. Otherwise — or if the model is unreachable, out of credits or slow —
 *      the best keyword-matching snippet is returned directly, which is how this
 *      has always worked. A missing key must never leave the demo without a bot.
 */
router.get('/', async (req, res) => {
  // Role and account come from server-side session state (roleContext), not from
  // anything the caller sends, so the bot cannot be told it is talking to an admin.
  const { role, currentUser } = res.locals;
  const question = String(req.query.q || '').slice(0, 500);
  if (!question.trim()) {
    return res.status(400).json({ success: false, error: 'Ask a question.' });
  }

  if (SMALL_TALK.test(question)) {
    return res.json({
      success: true,
      data: { answer: SMALL_TALK_REPLY, source: null, matched: true, generated: false },
    });
  }

  if (IDENTITY.test(question)) {
    return res.json({
      success: true,
      data: { answer: identityReply(role, currentUser), source: null, matched: true, generated: false },
    });
  }

  const roleLabel = ROLE_LABEL[role] || null;

  if (ai.isConfigured()) {
    const entries = await allEntries();
    const model = await answerWithModel(question, entries, roleLabel);
    if (model.usedModel) {
      return res.json({
        success: true,
        data: {
          answer: model.answer,
          // The model names which numbered entry it used and chatbotLlm maps it
          // back to our own source string, so the citation cannot be invented.
          source: model.source || null,
          matched: true,
          generated: true,
          model: ai.MODEL,
        },
      });
    }
    // Fall through to retrieval, and say why in a field the widget ignores but
    // an operator checking the endpoint can see.
    const fallback = await answer(question);
    return res.json({
      success: true,
      data: { ...fallback, generated: false, modelError: model.error },
    });
  }

  res.json({ success: true, data: { ...(await answer(question)), generated: false } });
});

module.exports = router;
