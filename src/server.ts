import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  getStats,
  getChats,
  getRecentActivity,
  getActivityByDomain,
  getDailyActivity,
} from "./analytics";
import { getCacheStats } from "./cache";

const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS
  ? process.env.ADMIN_USER_IDS.split(",").map((id) => parseInt(id.trim(), 10))
  : [];

let botToken: string;

/**
 * Validate Telegram Mini App initData using HMAC-SHA256
 * See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData: string): { valid: boolean; userId?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };

    // Remove hash from params and sort alphabetically
    params.delete("hash");
    const entries = Array.from(params.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // HMAC key: HMAC-SHA256 of bot token with "WebAppData" as key
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== hash) return { valid: false };

    // Extract user ID
    const userStr = params.get("user");
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return { valid: true, userId: user.id };
      } catch {
        return { valid: true };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false };
  }
}

/**
 * Authenticate a request using Telegram initData
 * Checks Authorization header or query parameter
 */
function authenticate(
  req: http.IncomingMessage
): { authenticated: boolean; userId?: number } {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Try Authorization header first
  let initData = req.headers.authorization;

  // Then try query parameter
  if (!initData) {
    initData = url.searchParams.get("initData") ?? undefined;
  }

  if (!initData) return { authenticated: false };

  const result = validateInitData(initData);
  if (!result.valid) return { authenticated: false };

  // Check admin user whitelist if configured
  if (ADMIN_USER_IDS.length > 0 && result.userId) {
    if (!ADMIN_USER_IDS.includes(result.userId)) {
      return { authenticated: false };
    }
  }

  return { authenticated: true, userId: result.userId };
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, data: any, status: number = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

/**
 * Send HTML response
 */
function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(html);
}

// Cache the HTML content
let cachedHtml: string | null = null;

/**
 * Load the Mini App HTML file
 */
function getWebAppHtml(): string {
  if (!cachedHtml) {
    const htmlPath = path.join(__dirname, "webapp", "index.html");
    cachedHtml = fs.readFileSync(htmlPath, "utf-8");
  }
  return cachedHtml;
}

/**
 * Start the admin HTTP server
 */
export function startServer(token: string, port: number = 3000): http.Server {
  botToken = token;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });
      res.end();
      return;
    }

    // Serve the Mini App HTML (no auth required — auth happens via initData in API calls)
    if (pathname === "/" || pathname === "/index.html") {
      try {
        sendHtml(res, getWebAppHtml());
      } catch (err) {
        sendJson(res, { error: "Mini App HTML not found" }, 500);
      }
      return;
    }

    // All API routes require authentication
    if (pathname.startsWith("/api/")) {
      const auth = authenticate(req);
      if (!auth.authenticated) {
        sendJson(res, { error: "Unauthorized" }, 401);
        return;
      }

      try {
        switch (pathname) {
          case "/api/stats": {
            const stats = getStats();
            const cacheStats = getCacheStats();
            sendJson(res, { ...stats, cache: cacheStats });
            break;
          }
          case "/api/chats":
            sendJson(res, getChats());
            break;
          case "/api/activity":
            sendJson(res, getRecentActivity(50));
            break;
          case "/api/activity/daily":
            sendJson(res, getDailyActivity(30));
            break;
          case "/api/activity/domains":
            sendJson(res, getActivityByDomain());
            break;
          default:
            sendJson(res, { error: "Not found" }, 404);
        }
      } catch (err: any) {
        console.error(`API error: ${err.message}`);
        sendJson(res, { error: "Internal server error" }, 500);
      }
      return;
    }

    sendJson(res, { error: "Not found" }, 404);
  });

  server.listen(port, () => {
    console.log(`Admin server running on port ${port}`);
  });

  return server;
}
