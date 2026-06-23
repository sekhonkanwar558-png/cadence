import { google } from "googleapis";

export interface CalendarBlockInput {
  title: string;
  start_iso: string;
  end_iso: string;
  description?: string;
}

export interface CreatedEvent {
  eventLink: string;
  eventId: string;
}

/**
 * Create an event on the user's primary Google Calendar using their OAuth
 * access token (taken from the NextAuth session on Day 1).
 */
export async function createCalendarEvent(
  accessToken: string,
  input: CalendarBlockInput,
): Promise<CreatedEvent> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth });

  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.title,
      description: input.description,
      // start_iso / end_iso carry a UTC offset, so Google resolves the time
      // correctly without a separate timeZone field.
      start: { dateTime: input.start_iso },
      end: { dateTime: input.end_iso },
    },
  });

  return {
    eventLink: res.data.htmlLink ?? "",
    eventId: res.data.id ?? "",
  };
}
