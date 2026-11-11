# AI Collaboration Notes

## Tools used

AI assistance was used throughout development for architecture discussions, implementation guidance, debugging, code generation and documentation.

- ChatGPT (GPT-6): project planning, Next.js and Supabase implementation guidance, webhook integration, debugging, testing instructions and documentation.
- Claude: additional AI-assisted development and technical review.
- Visual Studio Code: editing, running and validating the application.

The developer made the integration decisions, configured the external services, ran commands, tested the deployed application and verified the results.

## Key engineering decisions

1. **Next.js and Vercel:** Used Next.js for the authenticated dashboard and server-side webhook endpoint, with Vercel providing a public deployment that GitHub can reach.
2. **Supabase:** Selected Supabase for GitHub authentication, PostgreSQL persistence and user-scoped data access.
3. **GitHub webhooks and Slack Incoming Webhooks:** Used GitHub's signed webhook delivery mechanism and Slack Incoming Webhooks to keep the integration simple and suitable for free tiers.
4. **Dynamic Automation Rules Engine:** Transitioned hardcoded conditions to dynamic Supabase-backed rules evaluated per repository, with fallback to default bug detection.
5. **Durable Downstream Retries:** Added exponential retry handling for external GitHub and Slack calls to guard against transient network errors.

## Hardest debugging experience

The GitHub webhook initially returned HTTP 401 because the secret configured in GitHub did not match the application's environment variable. The delivery history exposed the failure. The webhook configuration was corrected and the event was redelivered successfully.

Another development mistake involved pushing while the local Git branch was behind the remote branch. A fetch revealed the additional remote commit. Rebasing the local dashboard commit on top of the remote commit resolved the divergence without losing either change.

These experiences reinforced the importance of inspecting actual logs, delivery history and Git state instead of assuming an integration has succeeded.

## Developer and AI responsibilities

AI helped explain unfamiliar framework concepts, propose implementation steps and generate code. The developer operated the GitHub, Supabase, Slack and Vercel dashboards, configured credentials, ran the application and verified the real integration results.

## Enhancements implemented

- **Configurable automation rules:** Implemented dynamic rule evaluation from Supabase with full dashboard management (create rules with custom keywords, action labels, Slack alerts, and enable/disable toggles).
- **Durable retries & failure logging:** Added bounded retries for downstream GitHub REST API and Slack Incoming Webhook requests, recording explicit failure action logs to ensure no events or errors are silently lost.
- **Strict lint & type verification:** Fixed ESLint rules and Next.js client component navigation to ensure zero warnings or errors.

## Improvements with more time

- Encrypt stored GitHub credentials and transition to GitHub App installation authentication.
- Add automated unit and integration tests for webhook signatures, duplicate deliveries and downstream failure recovery.
- Add optional AI-based issue summarisation and triage using a free-tier model.

## AI context files

`AGENTS.md` is included in the repository and provides project-specific AI instructions. No separate `CLAUDE.md` or `.cursorrules` file was used.
