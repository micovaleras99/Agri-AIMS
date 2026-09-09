// ============================================================
// AGRI-AIMS — Client-side JavaScript (main.js)
// Handles: Chatbot widget, notifications, UI helpers
// ============================================================

// ── Notification Dropdown ─────────────────────────────────
function toggleNotifications() {
    const dd = document.getElementById('notifDropdown');
    if (!dd) return;
    dd.classList.toggle('show');
    syncExpanded('bellIcon', dd.classList.contains('show'));
}

// Close notif dropdown on outside click
document.addEventListener('click', (e) => {
    const dd   = document.getElementById('notifDropdown');
    const bell = document.getElementById('bellIcon');
    if (dd && bell && !dd.contains(e.target) && !bell.contains(e.target)) {
        dd.classList.remove('show');
    }
});

// ── Toast Notification ────────────────────────────────────
function showNotification(message, type = 'info') {
    const colors = {
        success: '#27ae60',
        error:   '#e74c3c',
        // Every caller in the views passes Bootstrap's name for this colour, so
        // without the alias a failed login or a failed send fell through to the
        // blue "info" default and did not read as an error at all.
        danger:  '#e74c3c',
        warning: '#f39c12',
        info:    '#3498db'
    };

    const el = document.createElement('div');
    el.style.cssText = `
        position:fixed; top:80px; right:20px; z-index:9999;
        background:${colors[type] || colors.info};
        color:#fff; padding:14px 22px; border-radius:12px;
        box-shadow:0 8px 24px rgba(0,0,0,.15);
        font-size:14px; font-weight:600; max-width:360px;
        animation: slideIn .3s ease;
    `;
    el.textContent = message;
    document.body.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .3s';
        setTimeout(() => document.body.removeChild(el), 300);
    }, 3000);
}

// ── AgriBot Chatbot ───────────────────────────────────────
function toggleChatbot(event) {
    if (event) event.stopPropagation();
    const widget = document.getElementById('chatbotWidget');
    const bubble = document.getElementById('chatbotBubble');
    const isOpen = widget && widget.style.display !== 'none';

    if (widget && bubble) {
        if (isOpen) {
            widget.style.display = 'none';
            bubble.style.display = 'flex';
            bubble.setAttribute('aria-expanded', 'false');
            // Closing the panel left focus on an element that had just been
            // hidden, which drops the keyboard user back at the top of the
            // document. Hand it back to the control they opened it with.
            bubble.focus();
        } else {
            widget.style.display = 'block';
            bubble.style.display = 'none';
            bubble.setAttribute('aria-expanded', 'true');
            const badge = document.getElementById('chatbotBadge');
            if (badge) badge.style.display = 'none';
            setTimeout(() => {
                const input = document.getElementById('chatbotInput');
                if (input) input.focus();
                scrollChatbotToBottom();
            }, 50);
        }
    }
}

function scrollChatbotToBottom() {
    const msgs = document.getElementById('chatbotMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function sendChatbotMessage() {
    const input   = document.getElementById('chatbotInput');
    const message = input ? input.value.trim() : '';
    if (!message) return;

    const container = document.getElementById('chatbotMessages');
    if (!container) return;

    const inner = `<p>${escapeHtml(message)}</p><span class="message-time">${chatbotTime()}</span>`;
    appendChatMessage('user', inner);
    saveChatEntry('user', inner);
    input.value = '';

    // Show the bot "typing" while the request is out, so the wait (up to the
    // model timeout) reads as a reply on the way rather than a frozen widget.
    showChatbotTyping();

    // Answers come from the server, which reads the same LSA reference data the
    // rest of the app enforces. The reply shows the answer alone — the guideline
    // source is still returned by the API and used for grounding, just not shown.
    fetch('/api/chatbot?q=' + encodeURIComponent(message))
        .then((r) => r.json())
        .then((j) => {
            const d = (j && j.data) || {};
            removeChatbotTyping();
            showChatbotReply(d.answer || '');
        })
        .catch(() => {
            removeChatbotTyping();
            showChatbotReply(
                'I could not reach the server just now. Contact ATI Region V at '
                + 'rtc5_dcc@ati.da.gov.ph or 054-477-1579.'
            );
        });
}

/** Short clock label ("10:47 AM") for a message, in the viewer's locale. */
function chatbotTime() {
    return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Turn a plain-text answer into readable HTML: escape it (still safe), then
 * start each numbered step ("1)", "2.", …) and each real line break on its own
 * line, so a run of steps stacks instead of running together as one block.
 * Deliberately not a strict <ol> — model answers often trail prose after the
 * last number, which a list would wrongly fold into the final item.
 */
function formatChatbotAnswer(text) {
    let safe = escapeHtml(String(text));
    safe = safe.replace(/\n+/g, '<br>');
    // Break before a numbered marker that follows a space, so intro text and
    // each step split apart. Hyphen-joined codes (ATI-QF-PAD-162) are untouched
    // because the digits there are not preceded by whitespace.
    safe = safe.replace(/\s+(?=\d+[.)]\s)/g, '<br>');
    return safe;
}

/** The signed-in user's own avatar: photo, then initials, then a generic icon. */
function chatbotUserAvatar(container) {
    const photo = container.dataset.userPhoto;
    const initials = container.dataset.userInitials;
    if (photo) return `<div class="message-avatar"><img class="avatar-photo" src="${escapeHtml(photo)}" alt="You"></div>`;
    if (initials) return `<div class="message-avatar">${escapeHtml(initials)}</div>`;
    return '<div class="message-avatar"><i class="bi bi-person"></i></div>';
}

/** Append one bubble. `who` is 'user' or 'bot'; `inner` is the message-content HTML. */
function appendChatMessage(who, inner) {
    const container = document.getElementById('chatbotMessages');
    if (!container) return;
    const avatar = who === 'user'
        ? chatbotUserAvatar(container)
        : '<div class="message-avatar"><i class="bi bi-robot"></i></div>';
    container.insertAdjacentHTML('beforeend',
        `<div class="chatbot-message ${who}">${avatar}<div class="message-content">${inner}</div></div>`);
    scrollChatbotToBottom();
}

function showChatbotTyping() {
    const container = document.getElementById('chatbotMessages');
    if (!container || document.getElementById('chatbotTyping')) return;
    container.insertAdjacentHTML('beforeend', `
        <div class="chatbot-message bot" id="chatbotTyping">
            <div class="message-avatar"><i class="bi bi-robot"></i></div>
            <div class="message-content"><span class="chatbot-typing" aria-label="AgriBot is typing"><span></span><span></span><span></span></span></div>
        </div>
    `);
    scrollChatbotToBottom();
}

function removeChatbotTyping() {
    const t = document.getElementById('chatbotTyping');
    if (t) t.remove();
}

// Every bot reply is formatted here — success answers, greetings, identity and
// the offline message alike — so the clean structure applies to all responses.
// The argument is plain text; formatChatbotAnswer escapes and lays it out.
function showChatbotReply(text) {
    const inner = `<p>${formatChatbotAnswer(text)}</p><span class="message-time">${chatbotTime()}</span>`;
    appendChatMessage('bot', inner);
    saveChatEntry('bot', inner);
}

// ── Chat history (saved in the browser, per signed-in user) ───────────────
// localStorage, not the server: the widget is per-browser and public, so this
// keeps a reload from wiping the conversation without a table, a route, or the
// privacy surface of storing chats server-side. Scoped by user id so a shared
// computer does not show one person's chat to the next. Best-effort — private
// mode and cleared storage just mean no history, never an error.
function chatbotHistoryKey() {
    const c = document.getElementById('chatbotMessages');
    return 'agri_chat:' + ((c && c.dataset.userId) || 'guest');
}

function loadChatHistory() {
    try { return JSON.parse(localStorage.getItem(chatbotHistoryKey())) || []; }
    catch (e) { return []; }
}

function saveChatEntry(who, inner) {
    try {
        const h = loadChatHistory();
        h.push({ who: who, inner: inner });
        // Cap so a long-running account cannot grow the store without bound.
        localStorage.setItem(chatbotHistoryKey(), JSON.stringify(h.slice(-100)));
    } catch (e) { /* storage unavailable — history just will not persist */ }
}

function restoreChatHistory() {
    const h = loadChatHistory();
    h.forEach(function (m) { appendChatMessage(m.who, m.inner); });
}

// Wipe the saved conversation and the on-screen bubbles, keeping only the
// first (the static greeting). Wired to the header's clear button.
function clearChatbot() {
    try { localStorage.removeItem(chatbotHistoryKey()); } catch (e) { /* nothing to clear */ }
    const c = document.getElementById('chatbotMessages');
    if (!c) return;
    c.querySelectorAll('.chatbot-message').forEach(function (el, i) { if (i > 0) el.remove(); });
}

document.addEventListener('DOMContentLoaded', restoreChatHistory);

function sendQuickReply(message) {
    const input = document.getElementById('chatbotInput');
    if (input) {
        input.value = message;
        sendChatbotMessage();
    }
}

function handleChatbotEnter(event) {
    if (event.key === 'Enter') sendChatbotMessage();
}

// ── Chatbot Drag ──────────────────────────────────────────
(function initChatbotDrag() {
    document.addEventListener('DOMContentLoaded', () => {
        const widget = document.getElementById('chatbotWidget');
        const handle = document.getElementById('chatbotDragHandle');
        if (!widget || !handle) return;

        let isDragging = false, startX, startY, startLeft, startTop;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.chatbot-close-btn')) return;
            isDragging = true;
            const rect = widget.getBoundingClientRect();
            widget.style.left   = rect.left + 'px';
            widget.style.top    = rect.top  + 'px';
            widget.style.right  = 'auto';
            widget.style.bottom = 'auto';
            startX = e.clientX; startY = e.clientY;
            startLeft = rect.left; startTop = rect.top;
            widget.style.transition = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newLeft = startLeft + (e.clientX - startX);
            let newTop  = startTop  + (e.clientY - startY);
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - widget.offsetWidth));
            newTop  = Math.max(0, Math.min(newTop,  window.innerHeight - widget.offsetHeight));
            widget.style.left = newLeft + 'px';
            widget.style.top  = newTop  + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            if (widget) widget.style.transition = '';
        });
    });
})();

// ── Utility ───────────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ── Keyboard activation for elements that act as buttons ──────────────────
//
// Several controls are <div>s or <i>s with an onclick: the notification bell,
// the chatbot bubble, the four role cards on the login page, the community
// channel list, the document drop zone. A real <button> responds to Enter and
// Space for free; these did not, so a keyboard user could see the control,
// focus it, and get nothing.
//
// The markup now carries role="button" (or role="radio") and tabindex="0".
// One delegated listener supplies the activation for all of them rather than a
// handler per control — there is one place to fix if it is ever wrong, and any
// control added later is covered without touching this file.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;

    const el = e.target.closest('[role="button"], [role="radio"]');
    // A real button, link, or form control already handles these keys, and
    // intercepting them here would fire the action twice.
    if (!el || el.matches('button, a, input, select, textarea')) return;
    if (el.getAttribute('aria-disabled') === 'true') return;

    // Space scrolls the page by default; Enter inside a form would submit it.
    e.preventDefault();
    el.click();
});

// Keeps aria-expanded honest on the two controls that open a panel. Screen
// readers announce "collapsed"/"expanded" from this attribute, so a stale
// value is worse than none.
function syncExpanded(controlId, isOpen) {
    const el = document.getElementById(controlId);
    if (el) el.setAttribute('aria-expanded', String(isOpen));
}
