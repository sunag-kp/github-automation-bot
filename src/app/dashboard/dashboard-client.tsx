
"use client";

import { useEffect, useState } from "react";
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

export default function DashboardClient() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [repositories, setRepositories] = useState<ConnectedRepo[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [actions, setActions] = useState<DashboardAction[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

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
    setDataLoading(true);

    const [eventResult, actionResult] = await Promise.all([
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
    ]);

    if (eventResult.error) console.error("Event loading failed:", eventResult.error.message);
    if (actionResult.error) console.error("Action loading failed:", actionResult.error.message);

    setEvents((eventResult.data ?? []) as DashboardEvent[]);
    setActions((actionResult.data ?? []) as DashboardAction[]);
    setDataLoading(false);
  }

  useEffect(() => {
    loadConnectedRepos();
    loadDashboardData();
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

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

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

            <button
              onClick={openRepositorySelector}
              className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium hover:bg-blue-500"
            >
              + Connect Repository
            </button>
          </header>

          <div className="mt-8 rounded-lg border border-blue-900 bg-blue-950/40 p-4 text-sm text-blue-200">
            GitHub authentication is connected. Repository data is loaded from
            GitHub and saved in Supabase.
          </div>

          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total Events", String(events.length), "Latest 50 stored events"],
              ["Successful Actions", String(actions.filter((item) => item.status.toLowerCase() === "success").length), "Logged successful actions"],
              ["Failed Actions", String(actions.filter((item) => ["failed", "error"].includes(item.status.toLowerCase())).length), "Logged failed actions"],
              ["Connected Repos", String(repositories.length), "Saved in Supabase"],
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

          <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 xl:col-span-2">
              <h3 className="text-lg font-semibold">
                {activeTab === "Repositories"
                  ? "Connected Repositories"
                  : "Recent Activity"}
              </h3>

              {activeTab === "Repositories" ? (
                <div className="mt-6 space-y-4">
                  {repositories.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No repositories connected yet.
                    </p>
                  )}

                  {repositories.map((repo) => (
                    <div
                      key={repo.id}
                      className="rounded-lg border border-slate-800 p-4"
                    >
                      <p className="font-medium">{repo.full_name}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        Webhook: {repo.webhook_active ? "Active" : "Not configured"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  {dataLoading && <p className="text-sm text-slate-400">Loading live activity…</p>}

                  {!dataLoading && events.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No GitHub events stored yet. Push a commit or open an issue to test the webhook.
                    </p>
                  )}

                  {events.map((event) => {
                    const repo = repositories.find((item) => item.id === event.repository_id);

                    return (
                      <div key={event.id} className="border-b border-slate-800 pb-5">
                        <p className="font-medium">{event.event_type}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {repo?.full_name ?? "Connected repository"} · {new Date(event.created_at).toLocaleString()}
                        </p>
                        <p className="mt-2 text-sm text-blue-400">
                          Status: {event.processing_status}
                        </p>
                      </div>
                    );
                  })}

                  <div className="border-t border-slate-700 pt-5">
                    <h4 className="font-semibold">Recent Action Logs</h4>

                    {actions.length === 0 && (
                      <p className="mt-3 text-sm text-slate-400">No actions logged yet.</p>
                    )}

                    {actions.slice(0, 10).map((action) => (
                      <div key={action.id} className="mt-3 border-b border-slate-800 pb-3">
                        <p className="text-sm font-medium">
                          {action.action_type} · {action.status}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {action.message || "No details"} · {new Date(action.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="text-lg font-semibold">Automation Rules</h3>
              <p className="mt-1 text-sm text-slate-400">
                Configure your bot behaviour.
              </p>

              <div className="mt-6 rounded-lg border border-slate-700 p-4">
                <p className="font-medium">Bug Detection</p>
                <p className="mt-4 text-sm text-slate-400">
                  IF issue title contains:
                </p>
                <p className="mt-2 rounded bg-slate-800 p-2 text-sm text-blue-400">
                  bug
                </p>
                <p className="mt-4 text-sm text-slate-400">
                  THEN perform:
                </p>
                <ul className="mt-2 space-y-2 text-sm">
                  <li>✓ Add bug label</li>
                  <li>✓ Send Slack notification</li>
                </ul>
                <p className="mt-4 text-xs text-amber-400">
                  Rule execution will be enabled in a later step.
                </p>
              </div>
            </div>
          </div>

          <footer className="mt-10 border-t border-slate-800 pt-5 text-xs text-slate-500">
            GitHub Automation Bot · Next.js, TypeScript and Supabase
          </footer>
        </section>
      </div>

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
    </main>
  );
}
