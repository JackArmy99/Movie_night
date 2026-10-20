// Signed values using Web Crypto, so the same code runs in middleware (Edge)
// and in server actions (Node).
async function hmac(message: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || "dev-only-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The sign-in cookie: changes if the passcode changes, signing everyone out.
export const authToken = () => hmac(`auth:${process.env.APP_PASSCODE ?? ""}`);

// The private calendar link, so a phone calendar can read it without signing in.
export const calendarKey = async () => (await hmac("calendar")).slice(0, 24);

export const AUTH_COOKIE = "mn_auth";
export const USER_COOKIE = "mn_user";
