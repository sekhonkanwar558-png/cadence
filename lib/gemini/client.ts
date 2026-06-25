import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";

let client: GoogleGenAI | null = null;

/**
 * Lazily construct the Gemini client so importing this module never throws
 * at build time when GEMINI_API_KEY is absent.
 */
export function getAI(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
  }
  return client;
}

// Transient HTTP statuses worth retrying — 503 is the "model overloaded /
// temporarily unavailable" case; the others are adjacent transient failures.
const RETRYABLE_STATUSES = new Set([500, 503, 504]);

function isTransient(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e.status === "number" && RETRYABLE_STATUSES.has(e.status)) return true;
  if (typeof e.code === "number" && RETRYABLE_STATUSES.has(e.code)) return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("500") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("try again later")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * generateContent with exponential backoff on transient Gemini errors
 * (notably 503 "model overloaded"). Up to 3 retries with 1s / 2s / 4s delays;
 * non-transient errors throw immediately.
 */
export async function generateContentWithRetry(
  params: GenerateContentParameters,
): Promise<GenerateContentResponse> {
  const delays = [1000, 2000, 4000]; // 3 retries
  let lastErr: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await getAI().models.generateContent(params);
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length && isTransient(err)) {
        const wait = delays[attempt];
        console.warn(
          `[gemini] transient error on attempt ${attempt + 1}/${delays.length + 1}; retrying in ${wait}ms`,
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
