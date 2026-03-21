import { runLifeEngine } from "@/lib/life-engine-agent";

export const maxDuration = 60;

export async function GET(req: Request) {
  // Verify Vercel cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLifeEngine({ mode: "proactive" });
    return Response.json({
      status: "ok",
      response: result.response,
      actions: result.actions,
    });
  } catch (err) {
    console.error("[life-engine cron] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
