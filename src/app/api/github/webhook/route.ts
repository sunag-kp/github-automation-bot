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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delayMs = 500
): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (!res.ok && res.status >= 500 && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

async function githubRequest(url: string, token: string, method = "GET", body?: unknown) {
  return fetchWithRetry(url, {
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

type RuleRecord = {
  id?: number;
  name: string;
  keyword: string;
  action_label?: string | null;
  notify_slack?: boolean | null;
  enabled?: boolean | null;
};

interface WebhookPayload {
  action?: string;
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner?: { login: string };
  };
  issue?: {
    number: number;
    title?: string;
    html_url?: string;
    author_association?: string;
    user?: {
      login: string;
    };
  };
  [key: string]: unknown;
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

  let payload: WebhookPayload;
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

  // Idempotent delivery check: insert event with unique delivery_id constraint
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

  let overallActionType = "event_recorded";
  let overallStatus = "success";
  let overallMessage = `${eventType} received from ${repository.full_name}`;

  try {
    if (
      eventType === "issues" &&
      payload.action === "opened" &&
      typeof payload.issue?.number === "number"
    ) {
      const issueTitle = payload.issue.title ?? "";
      const issueNumber = payload.issue.number;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const token = repository.github_access_token;

      // Query active rules for this repository or globally for this user
      const { data: configuredRules, error: rulesError } = await supabase
        .from("automation_rules")
        .select("id, name, keyword, action_label, notify_slack, enabled")
        .eq("user_id", repository.user_id)
        .eq("enabled", true)
        .or(`repository_id.eq.${repository.id},repository_id.is.null`);

      if (rulesError) {
        console.warn("Rules query warning:", rulesError.message);
      }

      // Default fallback rule if no custom active rules exist in the database
      const activeRules: RuleRecord[] =
        configuredRules && configuredRules.length > 0
          ? configuredRules
          : [
              {
                name: "Bug Detection",
                keyword: "bug",
                action_label: "bug",
                notify_slack: true,
                enabled: true,
              },
            ];

      let matchedRuleCount = 0;

      for (const rule of activeRules) {
        const keyword = rule.keyword.trim();
        if (!keyword) continue;

        // Check if keyword is matched (case-insensitive)
        const regex = new RegExp(`\\b${keyword}\\b|${keyword}`, "i");
        if (!regex.test(issueTitle)) {
          continue;
        }

        matchedRuleCount++;
        overallActionType = "rule_matched";
        overallMessage = `Matched automation rule '${rule.name}' for issue #${issueNumber}`;

        // 1. GitHub label action (process goes as usual)
        if (rule.action_label && token && owner && repo) {
          const targetLabel = rule.action_label.trim();
          try {
            // Check if label exists, create if not
            const labelUrl = `https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(targetLabel)}`;
            const labelCheck = await githubRequest(labelUrl, token);

            if (labelCheck.status === 404) {
              const createLabel = await githubRequest(
                `https://api.github.com/repos/${owner}/${repo}/labels`,
                token,
                "POST",
                {
                  name: targetLabel,
                  color: targetLabel === "bug" ? "d73a4a" : "0366d6",
                  description: `Label detected by automation rule '${rule.name}'`,
                }
              );
              if (!createLabel.ok && createLabel.status !== 422) {
                console.warn(`Label create response: ${createLabel.status}`);
              }
            }

            const labelResponse = await githubRequest(
              `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
              token,
              "POST",
              { labels: [targetLabel] }
            );

            if (labelResponse.ok) {
              await supabase.from("action_logs").insert({
                user_id: repository.user_id,
                event_id: event.id,
                action_type: `${targetLabel}_label_added`,
                status: "success",
                message: `Added '${targetLabel}' label to issue #${issueNumber} via rule '${rule.name}'`,
              });
            } else {
              const errText = await labelResponse.text();
              console.error("GitHub label failed:", labelResponse.status, errText);
              await supabase.from("action_logs").insert({
                user_id: repository.user_id,
                event_id: event.id,
                action_type: `${targetLabel}_label_failed`,
                status: "failed",
                message: `Failed to add '${targetLabel}' label to issue #${issueNumber}: HTTP ${labelResponse.status}`,
              });
            }
          } catch (err) {
            console.error("Error executing GitHub label action:", err);
            await supabase.from("action_logs").insert({
              user_id: repository.user_id,
              event_id: event.id,
              action_type: "github_action_failed",
              status: "failed",
              message: err instanceof Error ? err.message : "GitHub label action failed",
            });
          }
        }

        // 2. Slack notification action (Collaborator role check)
        if (rule.notify_slack && process.env.SLACK_WEBHOOK_URL) {
          const authorAssociation = payload.issue?.author_association ?? "NONE";
          const authorLogin = payload.issue?.user?.login ?? "unknown";

          // Validate if author has a collaborator/owner/member role in the repository
          let isCollaborator = ["COLLABORATOR", "OWNER", "MEMBER"].includes(authorAssociation);

          // If author_association is ambiguous, check GitHub API directly
          if (!isCollaborator && token && owner && repo && payload.issue?.user?.login) {
            try {
              const collabRes = await githubRequest(
                `https://api.github.com/repos/${owner}/${repo}/collaborators/${encodeURIComponent(authorLogin)}`,
                token
              );
              if (collabRes.status === 204) {
                isCollaborator = true;
              }
            } catch (collabErr) {
              console.warn("GitHub collaborator API check:", collabErr);
            }
          }

          if (!isCollaborator) {
            // Initiator is NOT a collaborator: return false for Slack event and log audit trail
            await supabase.from("action_logs").insert({
              user_id: repository.user_id,
              event_id: event.id,
              action_type: "slack_notification_skipped",
              status: "skipped",
              message: `Slack alert skipped: issue #${issueNumber} opened by @${authorLogin} (role: ${authorAssociation}), not a collaborator`,
            });
          } else {
            // Initiator IS a collaborator: trigger Slack alert
            try {
              const slackResponse = await fetchWithRetry(process.env.SLACK_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text: `🔔 *${rule.name}* triggered by collaborator *@${authorLogin}* (${authorAssociation}) in *${repository.full_name}*\n*Issue:* <${payload.issue.html_url}|#${issueNumber} - ${issueTitle}>`,
                }),
              });

              if (slackResponse.ok) {
                await supabase.from("action_logs").insert({
                  user_id: repository.user_id,
                  event_id: event.id,
                  action_type: "slack_notification",
                  status: "success",
                  message: `Slack notification sent for rule '${rule.name}' (collaborator @${authorLogin})`,
                });
              } else {
                const errText = await slackResponse.text();
                console.error("Slack notification failed:", slackResponse.status, errText);
                await supabase.from("action_logs").insert({
                  user_id: repository.user_id,
                  event_id: event.id,
                  action_type: "slack_notification",
                  status: "failed",
                  message: `Slack webhook returned HTTP ${slackResponse.status}`,
                });
              }
            } catch (err) {
              console.error("Error sending Slack notification:", err);
              await supabase.from("action_logs").insert({
                user_id: repository.user_id,
                event_id: event.id,
                action_type: "slack_notification",
                status: "failed",
                message: err instanceof Error ? err.message : "Slack notification failed",
              });
            }
          }
        }
      }

      if (matchedRuleCount === 0) {
        overallActionType = "no_rule_matched";
        overallMessage = `Issue #${issueNumber} opened, but title did not match active rules`;
      }
    }
  } catch (error) {
    overallStatus = "failed";
    overallActionType = "automation_failed";
    overallMessage = error instanceof Error ? error.message : "Automation failed";
    console.error("Automation error:", overallMessage);
  }

  // Record main event audit log
  await supabase.from("action_logs").insert({
    user_id: repository.user_id,
    event_id: event.id,
    action_type: overallActionType,
    status: overallStatus,
    message: overallMessage,
  });

  // Update final processing status on the event
  await supabase
    .from("github_events")
    .update({ processing_status: overallStatus === "success" ? "processed" : "failed" })
    .eq("id", event.id);

  return NextResponse.json({
    message: "GitHub event processed",
    event_id: event.id,
    event_type: eventType,
    action: overallActionType,
    status: overallStatus,
  });
}
