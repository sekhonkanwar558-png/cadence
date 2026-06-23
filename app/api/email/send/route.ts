import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth-session";
import { upsertUser, getEmailDraftForSend, markDraftSent } from "@/lib/supabase/queries";
import { sendEmail, GmailAuthError } from "@/lib/google/gmail";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionContext(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    draftId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  if (!body.draftId) {
    return NextResponse.json({ ok: false, error: "Missing draft id." }, { status: 400 });
  }

  try {
    const userId = await upsertUser(session.email, session.name);
    const draft = await getEmailDraftForSend(body.draftId, userId);
    if (!draft) {
      return NextResponse.json({ ok: false, error: "Draft not found." }, { status: 404 });
    }
    if (draft.status === "sent") {
      return NextResponse.json({ ok: false, error: "This email was already sent." }, { status: 409 });
    }

    // Use the (possibly edited) values from the request, falling back to the stored draft.
    const to = (body.to ?? draft.to ?? "").trim();
    const subject = (body.subject ?? draft.subject ?? "").trim();
    const text = (body.body ?? draft.body ?? "").trim();
    if (!to || !subject || !text) {
      return NextResponse.json(
        { ok: false, error: "Add a recipient, subject, and message before sending." },
        { status: 400 },
      );
    }

    const credentials = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    };

    const { messageId } = await sendEmail(credentials, { to, subject, body: text });
    await markDraftSent(body.draftId, { to, subject, body: text, gmailId: messageId });

    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    if (err instanceof GmailAuthError) {
      return NextResponse.json(
        { ok: false, needsReauth: true, error: "Connect Gmail to send this." },
        { status: 403 },
      );
    }
    const message = err instanceof Error ? err.message : "Couldn't send the email.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
