/**
 * The top navigation, as data.
 *
 * It used to be four near-identical blocks of markup in navbar.ejs — one per
 * role — listing up to 11 top-level links each. That was too many to scan, and
 * the applicant branch carried guards like
 * `['admin','evaluator','operator'].includes(role)` that could never be true.
 *
 * Same destinations, grouped: 11 top-level items become 6. Nothing is removed,
 * and every route keeps its own authorisation — this only decides what is shown.
 */

/** Everyone who can sign in. */
const ALL = ['admin', 'evaluator', 'operator', 'applicant'];
/** The roles the LSA programme pages are built for. */
const LSA = ['admin', 'evaluator', 'operator'];

const NAV = [
  { label: 'Dashboard', icon: 'speedometer2', href: '/dashboard', page: 'dashboard', roles: ALL },

  {
    label: 'Applications', icon: 'file-earmark-text', roles: ALL,
    children: [
      // Operators are refused /applicants by routes/applicants.js, so it is not
      // offered to them; they reach their own farm through Monitoring instead.
      { label: 'Applications', icon: 'file-earmark-text', href: '/applicants', page: 'applicants', roles: ['admin', 'evaluator', 'applicant'] },
      { label: 'Documents', icon: 'folder', href: '/documents', page: 'documents', roles: ALL },
    ],
  },

  {
    label: 'Monitoring', icon: 'clipboard-data', roles: LSA,
    children: [
      { label: 'Farms', icon: 'tree', href: '/farms', page: 'farms', roles: LSA },
      { label: 'Compliance', icon: 'shield-check', href: '/compliance', page: 'compliance', roles: LSA },
      { label: 'Reports', icon: 'bar-chart', href: '/reports', page: 'reports', roles: LSA },
      // RSC-07: the accredited-LSA registry export for ATI Services. Staff only,
      // matching the export endpoint's own admin/evaluator gate.
      { label: 'Registry Export', icon: 'box-arrow-up-right', href: '/registry', page: 'registry', roles: ['admin', 'evaluator'] },
    ],
  },

  {
    label: 'Programs', icon: 'award', roles: ALL,
    children: [
      { label: 'Services', icon: 'calendar-event', href: '/services', page: 'services', roles: ALL },
      { label: 'LSA II Up-scaling', icon: 'arrow-up-circle', href: '/lsa2', page: 'lsa2', roles: LSA },
      { label: 'Renewal', icon: 'arrow-repeat', href: '/renewal', page: 'renewal', roles: LSA },
    ],
  },

  { label: 'Directory', icon: 'building', href: '/directory', page: 'directory', roles: ['admin', 'operator'] },
  { label: 'Community', icon: 'chat-dots', href: '/community', page: 'community', roles: ALL },
  { label: 'Messages', icon: 'envelope', href: '/messages', page: 'messages', roles: ALL },
];

/**
 * The navigation for one role, with empty groups dropped.
 * @param {string} role
 * @returns {Array<object>}
 */
function navFor(role) {
  return NAV
    .filter((item) => item.roles.includes(role))
    .map((item) => {
      if (!item.children) return item;
      const children = item.children.filter((c) => c.roles.includes(role));
      return { ...item, children };
    })
    // A group whose children are all hidden would render as a dead dropdown.
    // One surviving child is promoted to a plain link rather than a menu of one.
    .filter((item) => !item.children || item.children.length > 0)
    .map((item) => (item.children && item.children.length === 1 ? item.children[0] : item));
}

module.exports = { NAV, navFor };
