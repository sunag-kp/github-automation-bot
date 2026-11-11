# GitHub Automation Bot

A deployed event-driven GitHub automation application built with Next.js, TypeScript, Supabase and Slack.

When a connected GitHub repository receives an issue or push event, the application validates and records the webhook. For newly opened issues whose title contains "bug", it automatically adds a GitHub `bug` label and sends a Slack notification.

## Live application

https://github-automation-bot-one.vercel.app

## Features

- GitHub OAuth login through Supabase Auth.
- Connect GitHub repositories.
- GitHub webhooks for Issues and Push events.
- HMAC SHA-256 webhook signature validation.
- Duplicate delivery detection using GitHub delivery IDs.
- Supabase persistence for GitHub events and action logs.
- Automatic bug label creation and assignment for matching issues.
- Slack Incoming Webhook notifications.
- Authenticated dashboard with event metrics, activity and action logs.
- Vercel deployment.

## Architecture

1. User signs in using GitHub OAuth.
2. User connects a GitHub repository.
3. GitHub sends webhook events to the Next.js API endpoint.
4. The endpoint validates the HMAC signature and checks the delivery ID.
5. Events are stored in Supabase.
6. Matching bug issues trigger GitHub label writeback and Slack notification.
7. Events and action logs appear in the dashboard.

## Technology

- Next.js 16, React 19 and TypeScript
- Tailwind CSS
- Supabase Auth and PostgreSQL
- GitHub REST API and Webhooks
- Slack Incoming Webhooks
- Vercel

## Run locally

Requirements: Node.js and npm.

```bash
git clone https://github.com/sunag-kp/github-automation-bot.git
cd github-automation-bot
npm install
cp .env.example .env.local
```

Fill in the environment variables in `.env.local`.

Start the development server:

```bash
npm run dev
```

Open http://localhost:3000.

Run a production build:

```bash
npm run build
```

## Environment variables

| Variable | Purpose |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Supabase browser publishable key |
| SUPABASE_SERVICE_ROLE_KEY | Server-side Supabase administrative key |
| GITHUB_WEBHOOK_SECRET | Shared secret for webhook HMAC validation |
| SLACK_WEBHOOK_URL | Slack Incoming Webhook URL |

Never commit `.env.local` or real credentials. The Supabase service-role key must remain server-side and must never use a `NEXT_PUBLIC_` prefix.

## External service configuration

### Supabase

1. Create a Supabase project.
2. Enable GitHub under Authentication Providers.
3. Configure the GitHub OAuth client ID and secret.
4. Set the Supabase Site URL to the deployed application URL.
5. Add the production and localhost authentication callback URLs.
6. Create the application tables: `repositories`, `github_events`, `action_logs` and `automation_rules`.
7. Configure Row Level Security so users can access only their own repository data and event/action history.

### GitHub

1. Create a GitHub OAuth application.
2. Configure its callback URL as the Supabase Auth callback URL.
3. Sign in to the application and connect a repository.
4. Add a repository webhook pointing to:

   `https://github-automation-bot-one.vercel.app/api/github/webhook`

5. Select `application/json`, configure the same webhook secret as `GITHUB_WEBHOOK_SECRET`, and subscribe to Issues and Push events.

### Slack

1. Create a Slack app.
2. Enable Incoming Webhooks.
3. Add a webhook to a Slack channel.
4. Configure the generated URL as `SLACK_WEBHOOK_URL`.

## Deployment

The application is deployed on Vercel.

1. Import the GitHub repository into Vercel.
2. Configure all required environment variables in Project Settings.
3. Deploy the `main` branch.
4. Configure the Supabase production Site URL and GitHub repository webhook to use the public deployment URL.
5. Redeploy after changing production environment variables.

## Testing

1. Sign in using GitHub.
2. Connect the test repository.
3. Open an issue with `bug` in its title.
4. Verify that the `bug` label is added automatically.
5. Verify that a notification appears in the configured Slack channel.
6. Open the dashboard and verify that the event and action logs are recorded.
7. Push a commit and verify that a Push event is recorded.
8. Use GitHub webhook delivery history to inspect responses and redeliver test events.

## Current scope and limitations

- The bug-detection condition is defined in webhook code rather than configured dynamically through the UI.
- The current automation is an MVP; durable retry scheduling and recovery from downstream service failures require further hardening.
- GitHub OAuth is used instead of GitHub App installation authentication.
- Duplicate delivery detection is implemented using delivery IDs; it should not be confused with a complete distributed retry mechanism.

## Repository

https://github.com/sunag-kp/github-automation-bot
