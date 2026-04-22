'use strict';

function requireTier(_minTier = 'pro') {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Unauthorized' });

    const tier       = user.subscription_tier || 'free';
    const validUntil = user.sub_valid_until;

    const isPro = tier.startsWith('pro_') &&
      (tier === 'pro_lifetime' || (Number.isFinite(validUntil) && validUntil > Date.now()));

    if (!isPro) {
      return res.status(403).json({
        success: false, code: 'PAYWALL', message: 'Pro subscription required', upgradeUrl: '/pricing',
      });
    }
    next();
  };
}

module.exports = requireTier;
