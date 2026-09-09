// ============================================================
// notifications.js — drives the navbar bell from /api/notifications
// ============================================================

(function () {
  const POLL_MS = 60000;
  let loaded = false;

  function csrfToken() {
    const m = /(?:^|;\s*)agri_csrf=([^;]+)/.exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str == null ? '' : String(str)));
    return d.innerHTML;
  }

  /** "3 hours ago" — close enough for a dropdown, no library needed. */
  function relativeTime(iso) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hours / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    return new Date(iso).toLocaleDateString();
  }

  function setBadge(count) {
    const badge = document.getElementById('notifCount');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }

  function render(items) {
    const body = document.getElementById('notifBody');
    if (!body) return;

    if (!items.length) {
      body.innerHTML =
        '<div class="notif-item"><i class="bi bi-inbox text-secondary"></i>' +
        '<div><div class="notif-title">No notifications yet</div>' +
        '<div class="notif-time">Updates about your applications and activities appear here.</div></div></div>';
      return;
    }

    body.innerHTML = items
      .map((n) => {
        const cls = n.isRead ? 'notif-item' : 'notif-item unread';
        const inner =
          '<i class="bi bi-' + escapeHtml(n.icon || 'bell') + '"></i>' +
          '<div><div class="notif-title">' + escapeHtml(n.title) + '</div>' +
          (n.body ? '<div class="notif-body-text small text-muted">' + escapeHtml(n.body) + '</div>' : '') +
          '<div class="notif-time">' + escapeHtml(relativeTime(n.createdAt)) + '</div></div>';
        return n.link
          ? '<a class="' + cls + '" data-id="' + n.id + '" href="' + escapeHtml(n.link) + '">' + inner + '</a>'
          : '<div class="' + cls + '" data-id="' + n.id + '">' + inner + '</div>';
      })
      .join('');

    body.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => markRead(el.getAttribute('data-id')));
    });
  }

  async function load() {
    try {
      const res = await fetch('/api/notifications?limit=15', { credentials: 'same-origin' });
      if (!res.ok) return; // signed out or expired — leave the bell alone
      const json = await res.json();
      render(json.data || []);
      setBadge(json.meta ? json.meta.unread : 0);
      loaded = true;
    } catch (err) {
      /* offline or server restarting — try again on the next tick */
    }
  }

  async function markRead(id) {
    try {
      const res = await fetch('/api/notifications/' + encodeURIComponent(id) + '/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken() },
      });
      if (!res.ok) return;
      const json = await res.json();
      setBadge(json.data.unread);
      const el = document.querySelector('[data-id="' + id + '"]');
      if (el) el.classList.remove('unread');
    } catch (err) { /* ignore */ }
  }

  window.markAllNotificationsRead = async function markAllNotificationsRead() {
    try {
      const res = await fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken() },
      });
      if (!res.ok) return;
      setBadge(0);
      document.querySelectorAll('#notifBody .notif-item.unread').forEach((n) => n.classList.remove('unread'));
    } catch (err) { /* ignore */ }
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('notifDropdown')) return; // signed out
    load();
    setInterval(load, POLL_MS);
  });
})();
