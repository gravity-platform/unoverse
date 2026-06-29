/**
 * @unoverse/core — the MCP client.
 *
 * Reads neutral definitions + the resolved theme from the Unoverse MCP server
 * (resources/read), with a per-request bearer for secured servers. Caches both.
 * No UI framework here.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { UnoverseDefinition, ResolvedTheme } from "./types";

export interface UnoverseClientOptions {
  /**
   * Returns a fresh bearer token per request (e.g. an OIDC access_token). The token
   * rides the `Authorization` header on every MCP call so a secured server (default-deny)
   * accepts it. Omit for anonymous/dev (server with AUTH_ENABLED=false). Called per
   * request, so it can return a refreshed token transparently.
   */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
}

export class UnoverseClient {
  private client: Client;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private cache = new Map<string, UnoverseDefinition>();
  private themeCache = new Map<string, ResolvedTheme>();

  constructor(
    private readonly url: string,
    private readonly options: UnoverseClientOptions = {},
  ) {
    this.client = new Client({ name: "unoverse-core", version: "0.0.1" });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // Single shared connect — concurrent readDefinition() calls must not each
    // open a transport ("Already connected to a transport").
    if (!this.connecting) {
      this.connecting = (async () => {
        const getToken = this.options.getAccessToken;
        // Inject the bearer on every underlying request (fresh per call → refresh-safe).
        const authFetch = getToken
          ? async (url: string | URL, init?: RequestInit): Promise<Response> => {
              const token = await getToken();
              const headers = new Headers(init?.headers);
              if (token) headers.set("Authorization", `Bearer ${token}`);
              return fetch(url, { ...init, headers });
            }
          : undefined;
        const transport = new StreamableHTTPClientTransport(
          new URL(this.url),
          authFetch ? { fetch: authFetch } : undefined,
        );
        await this.client.connect(transport);
        this.connected = true;
      })().catch((err) => {
        // Don't cache a FAILED connect (e.g. a 401 before sign-in) — clearing
        // `connecting` lets a later call retry fresh once a token is available.
        this.connecting = null;
        throw err;
      });
    }
    return this.connecting;
  }

  /** resources/read a definition by URI (e.g. unoverse://components/Card). Cached. */
  async readDefinition(uri: string): Promise<UnoverseDefinition> {
    const cached = this.cache.get(uri);
    if (cached) return cached;
    await this.connect();
    const res = await this.client.readResource({ uri });
    const first = res.contents[0] as { text?: string };
    if (!first?.text) throw new Error(`No definition content for ${uri}`);
    const def = JSON.parse(first.text) as UnoverseDefinition;
    this.cache.set(uri, def);
    return def;
  }

  /**
   * resources/read the RESOLVED theme by name (e.g. "light"). The server owns the
   * values (rx/styles); the SDK only fetches — it bundles no tokens. Cached.
   */
  async readTheme(name = "light"): Promise<ResolvedTheme> {
    const cached = this.themeCache.get(name);
    if (cached) return cached;
    await this.connect();
    const res = await this.client.readResource({ uri: `unoverse://theme/${name}` });
    const first = res.contents[0] as { text?: string };
    if (!first?.text) throw new Error(`No theme content for ${name}`);
    const theme = JSON.parse(first.text) as ResolvedTheme;
    this.themeCache.set(name, theme);
    return theme;
  }

  /** List available theme names (e.g. ["light", "dark"]) from the server. */
  async listThemes(): Promise<string[]> {
    await this.connect();
    const res = await this.client.listResources();
    return res.resources
      .filter((r) => r.uri.startsWith("unoverse://theme/"))
      .map((r) => r.uri.replace("unoverse://theme/", ""));
  }

  /** List available component definitions (resources/templates + list). */
  async listComponents(): Promise<{ uri: string; name?: string }[]> {
    await this.connect();
    const res = await this.client.listResources();
    return res.resources
      .filter((r) => r.uri.startsWith("unoverse://components/"))
      .map((r) => ({ uri: r.uri, name: r.name }));
  }
}
