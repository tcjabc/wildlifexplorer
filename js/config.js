// Family accounts (Supabase). Both values are public by design: the publishable key only lets
// a browser talk to the project, and row level security decides what a signed-in parent may
// read or write. The secret key, the database password and access tokens never go in this repo.
export const SUPABASE_URL = 'https://yrgrihgmydzlxjzuoljq.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ez6qU4KBT2IauGVVjfGI-w_krarkGPC';

// Digits in the emailed sign-in code: the project's "Email OTP Length" (Authentication →
// Sign In / Providers → Email). Change both together.
export const CODE_LENGTH = 8;
