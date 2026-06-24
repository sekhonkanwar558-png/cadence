import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { generateContentWithRetry } from "@/lib/gemini/client";

export const dynamic = "force-dynamic";

const PROMPT =
  "Transcribe this audio exactly as spoken. Output only the transcription text — no " +
  "commentary, no quotation marks. Preserve task descriptions, dates, times, and names.";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "No audio received." }, { status: 400 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    // Gemini only transcribes here — it never generates a response.
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: base64 } },
            { text: PROMPT },
          ],
        },
      ],
    });

    const text = (response.text ?? "").trim();
    return NextResponse.json({ ok: true, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
