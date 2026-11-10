"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGitHub() {
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "read:user user:email repo admin:repo_hook",
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <div className="text-4xl">⚡</div>
        <h1 className="mt-4 text-2xl font-bold">GitHub Automation Bot</h1>
        <p className="mt-3 text-sm text-slate-400">
          Sign in with GitHub to connect a repository and automate its activity.
        </p>

        <button
          onClick={signInWithGitHub}
          disabled={loading}
          className="mt-8 w-full rounded-lg bg-white px-5 py-3 font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60"
        >
          {loading ? "Redirecting to GitHub..." : "Continue with GitHub"}
        </button>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <p className="mt-6 text-xs text-slate-500">
          GitHub authentication secured by Supabase.
        </p>
      </div>
    </main>
  );
}
