// Auth middleware helpers.

// Role hierarchy: pm < partner < admin
const ROLE_LEVEL = { pm: 1, partner: 2, admin: 3 };

function hasMinRole(sessionRole, minRole) {
  return (ROLE_LEVEL[sessionRole] || 0) >= (ROLE_LEVEL[minRole] || 99);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireRole(...allowed) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowed.includes(req.session.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Middleware: require at least the given role level.
function requireMinRole(minRole) {
  return function (req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!hasMinRole(req.session.role, minRole)) {
      return res.status(403).json({ error: `Requires ${minRole} role or above` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireMinRole, hasMinRole, ROLE_LEVEL };
