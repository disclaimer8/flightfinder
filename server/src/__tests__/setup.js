// Set environment variables before any module is loaded.
// This runs before every test file, so db.js picks up NODE_ENV=test
// and creates an in-memory SQLite database.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-jest-minimum-32-characters!!';
