const authService = require('../services/authService');
const { db } = require('../models/db');

const getTierCols = db.prepare(
  'SELECT subscription_tier, sub_valid_until FROM users WHERE id = ?',
);

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = authService.verifyAccessToken(token);
    const tierRow = getTierCols.get(payload.sub) || {};
    req.user = {
      id: payload.sub,
      email: payload.email,
      subscription_tier: tierRow.subscription_tier || 'free',
      sub_valid_until:   tierRow.sub_valid_until || null,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};
