"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
};

type ConnectedRepo = {
  id: number;
  github_repo_id: number;
  name: string;
  full_name: string;
  webhook_active: boolean;
};

type DashboardEvent = {
  id: number;
  repository_id: number | null;
  event_type: string;
  payload: Record<string, unknown>;
  processing_status: string;
  created_at: string;
};

type DashboardAction = {
  id: number;
  event_id: number | null;
  action_type: string;
  status: string;
  message: string | null;
  created_at: string;
};

type AutomationRule = {
  id: number;
  user_id: string;
  repository_id: number | null;
  name: string;
  keyword: string;
  action_label: string;
  notify_slack: boolean;
  enabled: boolean;
  created_at: string;
};

export default function DashboardClient() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [repositories, setRepositories] = useState<ConnectedRepo[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [actions, setActions] = useState<DashboardAction[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // New rule form state
  const [ruleName, setRuleName] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [ruleLabel, setRuleLabel] = useState("bug");
  const [ruleSlack, setRuleSlack] = useState(true);
  const [ruleRepoId, setRuleRepoId] = useState<string>("all");
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState("");

  const router = useRouter();
  const supabase = createClient();

  async function loadConnectedRepos() {
    const { data, error } = await supabase
      .from("repositories")
      .select("id, github_repo_id, name, full_name, webhook_active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Repository loading failed:", error.message);
      return;
    }

    setRepositories(data ?? []);
  }

  async function loadDashboardData() {
    const [eventResult, actionResult, ruleResult] = await Promise.all([
      supabase
        .from("github_events")
        .select("id, repository_id, event_type, payload, processing_status, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("action_logs")
        .select("id, event_id, action_type, status, message, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("automation_rules")
        .select("id, user_id, repository_id, name, keyword, action_label, notify_slack, enabled, created_at")
        .order("created_at", { ascending: true }),
    ]);

    if (eventResult.error) console.error("Event loading failed:", eventResult.error.message);
    if (actionResult.error) console.error("Action loading failed:", actionResult.error.message);
    if (ruleResult.error) console.error("Rule loading failed:", ruleResult.error.message);

    setEvents((eventResult.data ?? []) as DashboardEvent[]);
    setActions((actionResult.data ?? []) as DashboardAction[]);
    setRules((ruleResult.data ?? []) as AutomationRule[]);
    setDataLoading(false);
  }

  useEffect(() => {
    let isMounted = true;
    const fetchInitial = async () => {
      await Promise.all([loadConnectedRepos(), loadDashboardData()]);
      if (!isMounted) return;
    };
    void fetchInitial();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openRepositorySelector() {
    setShowModal(true);
    setLoading(true);
    setError("");
    setMessage("");
    setGithubRepos([]);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.provider_token) {
        throw new Error(
          "GitHub access token is unavailable. Please sign out and sign in again."
        );
      }

      const response = await fetch(
        "https://api.github.com/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100",
        {
          headers: {
            Authorization: `Bearer ${session.provider_token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `GitHub API error (${response.status}): ${await response.text()}`
        );
      }

      const data: GitHubRepo[] = await response.json();
      setGithubRepos(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load GitHub repositories"
      );
    } finally {
      setLoading(false);
    }
  }

  async function connectRepository(repo: GitHubRepo) {
    setSavingId(repo.id);
    setError("");
    setMessage("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Your login session has expired. Please sign in again.");
      }

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.provider_token) {
        throw new Error("GitHub access token is unavailable. Please sign out and sign in again.");
      }

      const { data: existing, error: lookupError } = await supabase
        .from("repositories")
        .select("id")
        .eq("user_id", user.id)
        .eq("github_repo_id", repo.id)
        .maybeSingle();

      if (lookupError) {
        throw new Error(lookupError.message);
      }

      if (existing) {
        const { error: updateError } = await supabase
          .from("repositories")
          .update({
            name: repo.name,
            full_name: repo.full_name,
            github_access_token: session.provider_token,
          })
          .eq("id", existing.id);

        if (updateError) throw new Error(updateError.message);
      } else {
        const { error: insertError } = await supabase
          .from("repositories")
          .insert({
            user_id: user.id,
            github_repo_id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            webhook_active: true,
            github_access_token: session.provider_token,
          });

        if (insertError) throw new Error(insertError.message);
      }

      await loadConnectedRepos();
      setMessage(`${repo.full_name} connected successfully.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect repository"
      );
    } finally {
      setSavingId(null);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    const { error: updateError } = await supabase
      .from("automation_rules")
      .update({ enabled: !rule.enabled })
      .eq("id", rule.id);

    if (updateError) {
      console.error("Failed to toggle rule:", updateError.message);
      return;
    }

    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
    );
  }

  async function deleteRule(id: number) {
    const { error: deleteError } = await supabase
      .from("automation_rules")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Failed to delete rule:", deleteError.message);
      return;
    }

    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setRuleSaving(true);
    setRuleError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Login session expired. Please refresh.");
      }

      if (!ruleName.trim() || !ruleKeyword.trim()) {
        throw new Error("Rule name and keyword are required.");
      }

      const repoId = ruleRepoId === "all" ? null : parseInt(ruleRepoId, 10);

      const { data: newRule, error: insertError } = await supabase
        .from("automation_rules")
        .insert({
          user_id: user.id,
          repository_id: repoId,
          name: ruleName.trim(),
          keyword: ruleKeyword.trim(),
          action_label: ruleLabel.trim() || "bug",
          notify_slack: ruleSlack,
          enabled: true,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      if (newRule) {
        setRules((prev) => [...prev, newRule as AutomationRule]);
      }

      setShowRuleModal(false);
      setRuleName("");
      setRuleKeyword("");
      setRuleLabel("bug");
      setRuleSlack(true);
      setRuleRepoId("all");
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setRuleSaving(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const activeRulesCount = rules.filter((r) => r.enabled).length;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 border-r border-slate-800 bg-slate-900 p-6 md:block">
          <h1 className="text-xl font-bold text-white">⚡ GitHub Bot</h1>
          <p className="mt-2 text-xs text-slate-400">
            Event-driven automation
          </p>

          <nav className="mt-10 space-y-2">
            {["Overview", "Repositories", "Activity Logs", "Automation Rules"].map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setActiveTab(item)}
                  className={`w-full rounded-lg px-4 py-3 text-left text-sm ${
                    activeTab === item
                      ? "bg-blue-600 text-white"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {item}
                </button>
              )
            )}
          </nav>

          <div className="mt-12 rounded-lg border border-slate-700 p-4">
            <p className="text-xs text-slate-400">Connected account</p>
            <p className="mt-2 font-medium">GitHub account</p>
            <p className="text-xs text-green-400">● Authenticated</p>
            <button
              onClick={signOut}
              className="mt-4 text-xs text-slate-400 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </aside>

        <section className="flex-1 p-6 md:p-10">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">{activeTab}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Monitor and automate your GitHub activity.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {activeTab === "Automation Rules" && (
                <button
                  onClick={() => setShowRuleModal(true)}
                  className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium hover:bg-green-500"
                >
                  + Add Automation Rule
                </button>
              )}
              <button
                onClick={openRepositorySelector}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium hover:bg-blue-500"
              >
                + Connect Repository
              </button>
            </div>
          </header>

          <div className="mt-8 rounded-lg border border-blue-900 bg-blue-950/40 p-4 text-sm text-blue-200">
            GitHub authentication is connected. Repository data is loaded from
            GitHub and saved in Supabase.
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total Events", String(events.length), "Latest stored webhook events"],
              [
                "Successful Actions",
                String(
                  actions.filter(
                    (item) =>
                      item.status.toLowerCase() === "success" &&
                      item.action_type !== "event_recorded"
                  ).length
                ),
                "Logged successful actions",
              ],
              [
                "Failed Actions",
                String(
                  actions.filter((item) =>
                    ["failed", "error"].includes(item.status.toLowerCase())
                  ).length
                ),
                "Logged failed actions",
              ],
              ["Active Rules", String(activeRulesCount), "Configured automation rules"],
            ].map(([title, value, description]) => (
              <div
                key={title}
                className="rounded-xl border border-slate-800 bg-slate-900 p-6"
              >
                <p className="text-sm text-slate-400">{title}</p>
                <h3 className="mt-3 text-3xl font-bold">{value}</h3>
                <p className="mt-2 text-xs text-slate-500">{description}</p>
              </div>
            ))}
          </div>

          {activeTab === "Repositories" && (
            <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold">Connected Repositories</h3>
              <div className="mt-5 space-y-3">
                {repositories.length === 0 && (
                  <p className="text-sm text-slate-400">No repositories connected yet.</p>
                )}
                {repositories.map((repo) => (
                  <div key={repo.id} className="rounded-lg border border-slate-800 p-4">
                    <p className="font-medium">{repo.full_name}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Webhook: {repo.webhook_active ? "Active" : "Not configured"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "Activity Logs" && (
            <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Activity Logs</h3>
                <button
                  onClick={loadDashboardData}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
                >
                  Refresh
                </button>
              </div>
              {dataLoading && <p className="mt-5 text-sm text-slate-400">Loading activity...</p>}
              {!dataLoading && actions.length === 0 && (
                <p className="mt-5 text-sm text-slate-400">No action logs yet.</p>
              )}
              <div className="mt-5 space-y-3">
                {actions.map((action) => (
                  <div key={action.id} className="rounded-lg border border-slate-800 p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-medium">{action.action_type.replaceAll("_", " ")}</p>
                      <span
                        className={
                          action.status.toLowerCase() === "success"
                            ? "text-sm text-green-400"
                            : "text-sm text-red-400"
                        }
                      >
                        {action.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{action.message || "No details"}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {new Date(action.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "Automation Rules" && (
            <div className="mt-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">Configured Automation Rules</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Rules evaluated dynamically when GitHub webhooks arrive.
                  </p>
                </div>
                <button
                  onClick={() => setShowRuleModal(true)}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500"
                >
                  + Create Rule
                </button>
              </div>

              {rules.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                  <p className="text-sm text-slate-400">
                    No custom rules in database. The system is operating on the default rule:
                  </p>
                  <div className="mt-4 rounded-lg border border-slate-700 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">Default Bug Detection</span>
                      <span className="rounded-full bg-green-950 px-2.5 py-0.5 text-xs text-green-400">
                        Default
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Trigger: Issue title contains &quot;bug&quot; → Add &apos;bug&apos; label &amp; Send Slack alert
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {rules.map((rule) => {
                  const targetRepo = repositories.find((r) => r.id === rule.repository_id);
                  return (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition hover:border-slate-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-white">{rule.name}</h4>
                          <p className="mt-1 text-xs text-slate-400">
                            Scope: {targetRepo ? targetRepo.full_name : "All Repositories"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleRule(rule)}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                              rule.enabled
                                ? "bg-green-950 text-green-400 hover:bg-green-900"
                                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            {rule.enabled ? "Enabled" : "Disabled"}
                          </button>
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="rounded p-1 text-xs text-slate-500 hover:text-red-400"
                            title="Delete rule"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 text-sm text-slate-300">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Keyword:</span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-blue-400">
                            {rule.keyword}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Action:</span>
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-emerald-400">
                            Add label &apos;{rule.action_label}&apos;
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Slack:</span>
                          <span className="text-xs text-slate-300">
                            {rule.notify_slack ? "✓ Alert channel" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "Overview" && (
            <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 xl:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Recent GitHub Events</h3>
                  <button
                    onClick={loadDashboardData}
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
                  >
                    Refresh
                  </button>
                </div>
                {dataLoading && <p className="mt-5 text-sm text-slate-400">Loading live activity...</p>}
                {!dataLoading && events.length === 0 && (
                  <p className="mt-5 text-sm text-slate-400">No GitHub events stored yet.</p>
                )}
                <div className="mt-5 space-y-4">
                  {events.slice(0, 10).map((event) => {
                    const repo = repositories.find((item) => item.id === event.repository_id);
                    return (
                      <div key={event.id} className="border-b border-slate-800 pb-4">
                        <p className="font-medium">{event.event_type}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {repo?.full_name ?? "Connected repository"} ·{" "}
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                        <p className="mt-2 text-sm text-blue-400">
                          Status: {event.processing_status}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <h3 className="text-lg font-semibold">Automation Engine</h3>
                <p className="mt-3 text-sm text-slate-400">Active Rules: {activeRulesCount}</p>
                <div className="mt-4 space-y-3">
                  {rules.slice(0, 3).map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-800 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white">{r.name}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            r.enabled ? "bg-green-950 text-green-400" : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          {r.enabled ? "Active" : "Off"}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-400">
                        Matches: &quot;{r.keyword}&quot; → label &apos;{r.action_label}&apos;
                      </p>
                    </div>
                  ))}
                  {rules.length === 0 && (
                    <div className="rounded-lg border border-slate-800 p-3 text-xs text-slate-400">
                      Default Bug Detection is active.
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setActiveTab("Automation Rules")}
                  className="mt-4 w-full rounded-lg bg-slate-800 py-2 text-center text-xs text-blue-400 hover:bg-slate-700"
                >
                  Manage Rules →
                </button>
              </div>
            </div>
          )}

          <footer className="mt-10 border-t border-slate-800 pt-5 text-xs text-slate-500">
            GitHub Automation Bot · Next.js, TypeScript and Supabase
          </footer>
        </section>
      </div>

      {/* Connect Repository Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Connect a GitHub Repository</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-400">
              Select a repository from your GitHub account.
            </p>

            {loading && (
              <p className="mt-6 text-sm text-slate-300">
                Loading your GitHub repositories...
              </p>
            )}

            {error && (
              <p className="mt-5 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            {message && (
              <p className="mt-5 rounded-lg border border-green-900 bg-green-950/40 p-3 text-sm text-green-300">
                {message}
              </p>
            )}

            <div className="mt-5 space-y-3">
              {githubRepos.map((repo) => {
                const alreadyConnected = repositories.some(
                  (connected) => connected.github_repo_id === repo.id
                );

                return (
                  <div
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-4"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{repo.full_name}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {repo.description || "No description"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {repo.private ? "Private" : "Public"}
                      </p>
                    </div>

                    <button
                      disabled={savingId === repo.id}
                      onClick={() => connectRepository(repo)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
                    >
                      {savingId === repo.id
                        ? "Saving..."
                        : alreadyConnected
                          ? "Refresh Access"
                          : "Connect"}
                    </button>
                  </div>
                );
              })}
            </div>

            {!loading && !error && githubRepos.length === 0 && (
              <p className="mt-6 text-sm text-slate-400">
                No repositories were returned by GitHub.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Create Automation Rule Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">New Automation Rule</h2>
              <button
                onClick={() => setShowRuleModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-400">
              Define a trigger keyword to automatically label issues and send Slack alerts.
            </p>

            {ruleError && (
              <p className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
                {ruleError}
              </p>
            )}

            <form onSubmit={createRule} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bug Detection or Urgent Alert"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Trigger Keyword</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. bug, urgent, security, help"
                  value={ruleKeyword}
                  onChange={(e) => setRuleKeyword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Matches when an opened issue title contains this word.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">GitHub Label to Apply</label>
                <input
                  type="text"
                  placeholder="e.g. bug, urgent, triage"
                  value={ruleLabel}
                  onChange={(e) => setRuleLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Target Repository</label>
                <select
                  value={ruleRepoId}
                  onChange={(e) => setRuleRepoId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">All Connected Repositories</option>
                  {repositories.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="notifySlackCheck"
                  checked={ruleSlack}
                  onChange={(e) => setRuleSlack(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-blue-600 focus:ring-0"
                />
                <label htmlFor="notifySlackCheck" className="text-xs text-slate-300">
                  Send notification to Slack channel
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ruleSaving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:bg-slate-700"
                >
                  {ruleSaving ? "Saving..." : "Create Rule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
