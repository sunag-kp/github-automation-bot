# GitHub Automation Bot

An event-driven GitHub automation platform built with Next.js, TypeScript, Supabase and Slack.

Automatically detects newly opened bug-related issues, applies GitHub labels, sends Slack notifications and maintains an activity dashboard.

## Features

- GitHub OAuth authentication
- Connect GitHub repositories
- GitHub webhooks for Issues and Push events
- HMAC SHA-256 webhook signature validation
- Duplicate webhook delivery detection
- Supabase event and action persistence
- Automatic bug label creation and assignment
- Slack notifications for detected bugs
- Dashboard with event metrics and recent activity
- Vercel deployment

## Architecture

GitHub Repository
       |
       v
GitHub Webhook
       |
       v
Next.js API Route
       |
       +---- Signature Validation
       |
       +---- Supabase Event Storage
       |
       +---- Bug Detection
       |         |
       |         +---- GitHub API: Add bug label
       |         |
       |         +---- Slack: Send notification
       |
       v
Supabase Action Logs
       |
       v
Next.js Dashboard

## Technology Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Supabase Authentication
- Supabase PostgreSQL
- GitHub REST API
- GitHub Webhooks
- Slack Incoming Webhooks
- Vercel

## Local Setup

Clone the repository:

```bash
git clone https://github.com/sunag-kp/github-automation-bot.git
cd github-automation-bot
npm install
