// middleware/auth.js - Session-based authentication middleware
function requireAuth(req, res, next) {
  // Try session first
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }

  // Fallback: accept headers (for Render where cookies drop)
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];

  if (userId && userRole) {
    req.user = { id: parseInt(userId), role: userRole };
    if (!req.session) req.session = {};
    req.session.user = req.user;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized. Please log in.' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    let user = null;
    if (req.session && req.session.user) {
      user = req.session.user;
    } else {
      const userId = req.headers['x-user-id'];
      const userRole = req.headers['x-user-role'];
      if (userId && userRole) {
        user = { id: parseInt(userId), role: userRole };
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }
    
    req.user = user;
    if (!req.session) req.session = {};
    req.session.user = user;
    next();
  };
}

module.exports = { requireAuth, requireRole };
