const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production-minimum-32-chars!!';
const JWT_EXPIRY = parseInt(process.env.JWT_EXPIRY || '900', 10);
const REFRESH_EXPIRY = parseInt(process.env.REFRESH_TOKEN_EXPIRY || '604800', 10);

// Dummy hash for timing-safe login when email not found
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvaluedummyhashvalue';

async function hashPassword(plaintext) {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

async function verifyPassword(hash, plaintext) {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

function generateAccessToken(userId, email) {
  return jwt.sign({ sub: userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function generateRefreshToken() {
  const raw = crypto.randomBytes(40).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, expiresAt: Date.now() + REFRESH_EXPIRY * 1000 };
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  JWT_EXPIRY,
  REFRESH_EXPIRY,
  DUMMY_HASH,
};
