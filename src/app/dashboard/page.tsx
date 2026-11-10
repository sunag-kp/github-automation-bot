
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function checkSession() {
      try {
        const result = await Promise.race([
          supabase.auth.getUser(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error("Supabase authentication timed out")),
              8000
            );
          }),
        ]);

        if (!active) return;

        if (result.error || !result.data.user) {
          console.error("Authentication check failed:", result.error);
          router.replace("/login");
          return;
        }

        setLoading(false);
      } catch (error) {
        if (!active) return;

        console.error("Authentication check error:", error);
        setAuthError(
          error instanceof Error ? error.message : "Unable to verify session"
        );
      }
    }

    checkSession();

    return () => {
      active = false;
    };
  }, [router]);

  if (authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-white">
        <div>
          <h1 className="text-xl font-semibold">
            Authentication check failed
          </h1>
          <p className="mt-3 text-sm text-red-400">{authError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-white px-5 py-2 font-semibold text-slate-950"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        Checking your session...
      </main>
    );
  }

  return <DashboardClient />;
}
