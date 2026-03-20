import { createServer } from "http";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
const REDIRECT_PORT = 3456;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first.",
    );
    console.error(
      "Get these from: https://console.cloud.google.com/apis/credentials",
    );
    process.exit(1);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\n1. Open this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\n2. Authorize the app, then wait for the redirect...\n");

  return new Promise<void>((resolve) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) return;

      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Error: no authorization code received.</h1>");
        server.close();
        resolve();
        return;
      }

      try {
        const tokenResponse = await fetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: REDIRECT_URI,
              grant_type: "authorization_code",
            }),
          },
        );

        const tokens = await tokenResponse.json();

        if (tokens.refresh_token) {
          console.log("\n✅ Success! Add this to your .env.local:\n");
          console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        } else {
          console.error(
            "\n⚠️  No refresh token received. Try revoking access at",
          );
          console.error(
            "https://myaccount.google.com/connections and re-running.\n",
          );
          console.log("Response:", JSON.stringify(tokens, null, 2));
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Done! Check your terminal for the refresh token. You can close this tab.</h1>",
        );
      } catch (err) {
        console.error("Token exchange failed:", err);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>Token exchange failed. Check terminal for details.</h1>");
      }

      server.close();
      resolve();
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(
        `Listening on http://localhost:${REDIRECT_PORT} for OAuth callback...`,
      );
    });
  });
}

main().catch(console.error);
