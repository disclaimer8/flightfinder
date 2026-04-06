// In web: relative URLs work fine (/api/...)
// In Android/iOS app: need full URL to the production server
export const API_BASE = import.meta.env.VITE_API_BASE || '';
