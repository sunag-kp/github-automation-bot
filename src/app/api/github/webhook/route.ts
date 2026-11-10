import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function verifySignature(body: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=")) return false;

  const receivedHex = signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(receivedHex, "hex");

  return received.length === expected.length &&
    timingSafeEqual(received, expected);
}

async function githubRequest(url: string, token: string, method = "GET", body?: unknown) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret || !supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const body = await request.text();

  if (!verifySignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const eventType = request.headers.get("x-github-event");

  if (!deliveryId || !eventType) {
    return NextResponse.json({ error: "Missing GitHub delivery headers" }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const githubRepoId = payload.repository?.id;
  if (!githubRepoId) {
    return NextResponse.json({ message: "No repository in event" });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: repository, error: lookupError } = await supabase
    .from("repositories")
    .select("id, user_id, full_name, github_access_token")
    .eq("github_repo_id", githubRepoId)
    .maybeSingle();

  if (lookupError) {
    console.error("Repository lookup failed:", lookupError.message);
    return NextResponse.json({ error: "Repository lookup failed" }, { status: 500 });
  }

  if (!repository) {
    return NextResponse.json({ message: "Repository not connected" }, { status: 202 });
  }

  const { data: event, error: insertError } = await supabase
    .from("github_events")
    .insert({
      user_id: repository.user_id,
      repository_id: repository.id,
      delivery_id: deliveryId,
      event_type: eventType,
      payload,
      processing_status: "received",
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ message: "Duplicate delivery ignored" });
    }
    console.error("Event insert failed:", insertError.message);
    return NextResponse.json({ error: "Event storage failed" }, { status: 500 });
  }

  let actionType = "event_recorded";
  let actionStatus = "success";
  let actionMessage = `${eventType} received from ${repository.full_name}`;

  try {
    if (
      eventType === "issues" &&
      payload.action === "opened" &&
      typeof payload.issue?.number === "number" &&
      /bug/i.test(payload.issue.title ?? "")
    ) {
      const token = repository.github_access_token;

      if (!token) {
        throw new Error("No GitHub access token saved. Reconnect this repository.");
      }

      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const issueNumber = payload.issue.number;

      // Ensure the bug label exists.
      const labelUrl = `https://api.github.com/repos/${owner}/${repo}/labels/bug`;
      const labelCheck = await githubRequest(labelUrl, token);

      if (labelCheck.status === 404) {
        const createLabel = await githubRequest(
          `https://api.github.com/repos/${owner}/${repo}/labels`,
          token,
          "POST",
          { name: "bug", color: "d73a4a", description: "Bug report detected by automation bot" }
        );
        if (!createLabel.ok && createLabel.status !== 422) {
          throw new Error(`Could not create bug label: ${createLabel.status}`);
        }
      } else if (!labelCheck.ok) {
        throw new Error(`Could not check bug label: ${labelCheck.status}`);
      }

      const labelResponse = await githubRequest(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
        token,
        "POST",
        { labels: ["bug"] }
      );

      if (!labelResponse.ok) {
        throw new Error(`GitHub label operation failed: ${labelResponse.status} ${await labelResponse.text()}`);
      }

      actionType = "bug_label_added";
      actionMessage = `Automatically added bug label to issue #${issueNumber}`;

      if (process.env.SLACK_WEBHOOK_URL) {
        const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🐛 Bug detected in ${repository.full_name}: ${payload.issue.title}\n${payload.issue.html_url}`,
          }),
        });

        if (!slackResponse.ok) {
          console.error("Slack notification failed:", slackResponse.status);
        } else {
          await supabase.from("action_logs").insert({
            user_id: repository.user_id,
            event_id: event.id,
            action_type: "slack_notification",
            status: "success",
            message: "Slack notification sent",
          });
        }
      }
    }
  } catch (error) {
    actionStatus = "failed";
    actionType = "automation_failed";
    actionMessage = error instanceof Error ? error.message : "Automation failed";
    console.error("Automation failed:", actionMessage);
  }

  await supabase.from("action_logs").insert({
    user_id: repository.user_id,
    event_id: event.id,
    action_type: actionType,
    status: actionStatus,
    message: actionMessage,
  });

  await supabase
    .from("github_events")
    .update({ processing_status: actionStatus === "success" ? "processed" : "failed" })
    .eq("id", event.id);

  return NextResponse.json({
    message: "GitHub event processed",
    event_id: event.id,
    event_type: eventType,
    action: actionType,
    status: actionStatus,
  });
}
