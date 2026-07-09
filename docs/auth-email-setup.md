# Auth email setup (confirmation & password reset)

## Environment variables

In your local `.env` (or hosting provider env):

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase anon key |
| `VITE_AUTH_REDIRECT_URL` | **Origin only** (no path), e.g. `http://localhost:5173` or `https://yourdomain.com`. Used for `emailRedirectTo` on sign-up and resend. |

`VITE_AUTH_REDIRECT_URL` **must** appear in **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs** (as `http://localhost:5173/auth` and/or your production `/auth` URL).

## Why emails don’t arrive

1. **Custom SMTP not configured** — Supabase’s default mail is limited. Configure **Project Settings → Authentication → SMTP** with SendGrid, Resend, AWS SES, etc.
2. **Redirect URL not allowed** — Sign-up can fail with `redirect_to` / `invalid redirect`; the app now surfaces that error instead of a false “success”.
3. **Spam folder** — Ask users to check spam and domain authentication (SPF/DKIM) for your SMTP domain.

## Vercel (or any static host): avoid 404 on `/auth`

Single-page apps only ship `index.html` at the root. A URL like `https://yoursite.vercel.app/auth` must still serve that file, or the host returns **404** before React runs.

This repo includes **`vercel.json`** with a rewrite so all routes fall back to `index.html`. After deploy, confirmation links to `…/auth#access_token=…` should load the app and show the login screen.

## Code behavior

- After saving `user_accounts`, the app calls `supabase.auth.signUp` with `emailRedirectTo: <VITE_AUTH_REDIRECT_URL>/auth`.
- If the email is **already registered** in Supabase Auth, the app calls `supabase.auth.resend({ type: 'signup', ... })` so a new confirmation email can be sent.
- When the confirmation link opens `/auth` with `#access_token=…&type=signup`, the auth page shows a short success message and the **Sign in** form.
