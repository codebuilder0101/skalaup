# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Auth email (sign-up confirmation & password reset)

Supabase sends confirmation and reset emails **from your Supabase project**, not from this React app. If users see “check your email” but nothing arrives:

1. **Redirect URLs** — In [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication** → **URL Configuration**:
   - Set **Site URL** to your app origin (e.g. `http://localhost:5173` or your production URL).
   - Under **Redirect URLs**, add the same origins plus `/auth` and `/reset-password` if needed, e.g.  
     `http://localhost:5173/auth`, `https://yourdomain.com/auth`
2. **Match the app** — Set `VITE_AUTH_REDIRECT_URL` in `.env` to that **same origin** (no trailing slash). The client uses it for `emailRedirectTo` on sign-up and resend.
3. **SMTP (required for reliable delivery)** — In **Project Settings** → **Authentication** → **SMTP Settings**, enable **Custom SMTP** and use a provider (SendGrid, Resend, SES, Mailgun, etc.). The built-in sender is limited and often blocked or rate-limited.
4. **Auth logs** — **Authentication** → **Users** (or **Logs**) to see send errors or bounce reasons.

After SMTP and URLs are correct, new registrations should receive the confirmation email (check spam as well).

More detail: [`docs/auth-email-setup.md`](docs/auth-email-setup.md).

## Organizations (Governance) and unit linking

- Run `supabase/organizations_table.sql` in the Supabase SQL editor so the **Organizations** page and the **Unit Details → Organization** dropdown use the same `public.organizations` table.
- Units load organization options from the database (`fetchOrganizationsList` in `src/lib/organizations.ts`). The list refreshes when the page loads, when the browser tab becomes visible again, and after you navigate back from Organizations—so add/delete updates are picked up.

## Medical specialties catalog (units & staff)

Main specialties in **Units → Dimensioning** and **Staff → Specialties** are loaded from Supabase table `medical_specialties` (Portuguese + English names). Stable `slug` values are stored in `units.rt_specialty_keys`, `outpatient_units.rt_specialty_keys`, and `staff_members.specialties`.

1. In the Supabase SQL editor, run `supabase/medical_specialties_table.sql` (creates the table, RLS read policy, and seeds all 57 specialties).
2. The app shows **Portuguese** labels when the UI language is **pt-BR**, and **English** otherwise.
3. Legacy values such as `shifts.specialties.*` or old outpatient labels are mapped to the new slugs when rows are loaded.

## AI Schedule Autopilot Setup

The schedules screen now supports automatic schedule generation based on `staff_members` data from Supabase.

### 1) Frontend environment variables

Create a local `.env` file with:

```sh
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=YOUR_SUPABASE_ANON_KEY
VITE_SCHEDULE_AI_ENDPOINT=YOUR_SUPABASE_EDGE_FUNCTION_URL
```

Example function URL:

`https://<project-ref>.functions.supabase.co/generate-schedule`

### 2) Deploy the Edge Function

This repository includes `supabase/functions/generate-schedule/index.ts`.

Set your OpenAI key as a Supabase function secret (server-side only):

```sh
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
supabase functions deploy generate-schedule
```

### 3) Scheduling rules enforced

- Maximum 4 consecutive hours per shift
- Uses day/night availability when available in staff data
- Respects each employee `max_weekly_hours`
- Prioritizes even assignment distribution across staff
