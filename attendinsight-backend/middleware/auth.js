// middleware/auth.js - Session-based authentication middleware
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
