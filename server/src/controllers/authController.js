const db = require('../models/db');
const authService = require('../services/authService');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth/refresh',
  maxAge: authService.REFRESH_EXPIRY * 1000,
};

function setRefreshCookie(res, raw) {
  res.cookie('refreshToken', raw, COOKIE_OPTS);
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { ...COOKIE_OPTS, maxAge: 0 });
}

exports.register = async (req, res) => {
  const { email, password } = req.validatedBody;
  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email already registered' });
  }
  const passwordHash = await authService.hashPassword(password);
  db.createUser(email, passwordHash);
  res.status(201).json({ success: true, message: 'Account created' });
};

exports.login = async (req, res) => {
  const { email, password } = req.validatedBody;
  const user = db.getUserByEmail(email);

  // Always run password verification to prevent timing oracle
  const hashToVerify = user ? user.password_hash : authService.DUMMY_HASH;
  const valid = await authService.verifyPassword(hashToVerify, password);

  if (!user || !valid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const accessToken = authService.generateAccessToken(user.id, user.email);
  const refresh = authService.generateRefreshToken();
  db.createRefreshToken(user.id, refresh.hash, refresh.expiresAt);

  setRefreshCookie(res, refresh.raw);
  res.json({ success: true, accessToken, expiresIn: authService.JWT_EXPIRY });
};

exports.refresh = (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (!raw) return res.status(401).json({ success: false, message: 'No refresh token' });

  const hash = db.hashToken(raw);
  const stored = db.getRefreshToken(hash);

  if (!stored || stored.expires_at < Date.now()) {
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }

  const user = db.getUserById(stored.user_id);
  if (!user) {
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: 'User not found' });
  }

  // Rotate refresh token
  db.deleteRefreshToken(hash);
  const newRefresh = authService.generateRefreshToken();
  db.createRefreshToken(user.id, newRefresh.hash, newRefresh.expiresAt);

  const accessToken = authService.generateAccessToken(user.id, user.email);
  setRefreshCookie(res, newRefresh.raw);
  res.json({ success: true, accessToken, expiresIn: authService.JWT_EXPIRY });
};

exports.logout = (req, res) => {
  const raw = req.cookies?.refreshToken;
  if (raw) {
    const hash = db.hashToken(raw);
    db.deleteRefreshToken(hash);
  }
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Logged out' });
};

exports.me = (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, user });
};
