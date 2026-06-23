import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { FunctionCallingConfigMode } from "@google/genai";
import { generateContentWithRetry } from "@/lib/gemini/client";
import { createCalendarBlock } from "@/lib/gemini/tools";
import { createCalendarEvent, type CalendarBlockInput } from "@/lib/google/calendar";

// Calendar API + Gemini are runtime-only; never statically optimize this route.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Pull the user's Google access token out of the NextAuth JWT (server-side only).
  const token = await getToken({ req });
  const accessToken = token?.accessToken;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "Not signed in with Google. Sign in and try again." },
      { status: 401 },
    );
  }

  // 2. Read the natural-language instruction (Day 1: client sends a hardcoded one).
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    timezone?: string;
  };
  const prompt =
    body.prompt?.trim() ||
    "Block 2-3pm tomorrow for focus work on my DBMS assignment.";
  const timezone = body.timezone || "UTC";

  // Ground the model in the current moment so it can resolve "tomorrow", etc.
  const now = new Date().toISOString();
  const contents = `The current time is ${now}. The user's timezone is ${timezone}. ${prompt}`;

  // 3. Run Gemini and FORCE it to emit a create_calendar_block call.
  let response;
  try {
    response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents,
      config: {
        tools: [{ functionDeclarations: [createCalendarBlock] }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ["create_calendar_block"],
          },
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gemini request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const call = response.functionCalls?.[0];
  if (!call || call.name !== "create_calendar_block") {
    return NextResponse.json(
      { ok: false, error: "Gemini did not call create_calendar_block.", text: response.text },
      { status: 502 },
    );
  }

  // 4. Execute the tool: create the real Calendar event.
  const args = call.args as unknown as CalendarBlockInput;
  try {
    const { eventLink, eventId } = await createCalendarEvent(accessToken, args);
    return NextResponse.json({ ok: true, eventLink, eventId, args });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create the event.";
    return NextResponse.json({ ok: false, error: message, args }, { status: 500 });
  }
}
