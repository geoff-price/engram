import { requireAuth } from "@/lib/auth";
import { captureThought } from "@/lib/capture";

export async function POST(req: Request) {
  const { error } = requireAuth(req);
  if (error) return error;

  const body = await req.json();
  const content = body?.content;
  if (!content || typeof content !== "string") {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const source = body?.source ?? "api";
  const result = await captureThought(content, source);
  return Response.json(result);
}
