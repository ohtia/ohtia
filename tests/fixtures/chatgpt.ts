import { generateKeyPairSync, sign } from "node:crypto";
import { vi, expect } from "vitest";
import { ChatGPTProvider } from "../../packages/main/src/chatgpt-provider.js";
import { chatGPTEndpoints } from "../../packages/main/src/chatgpt-sign-in.js";
import {
  CredentialStore,
  type CredentialEntryFactory,
} from "../../packages/main/src/credential-store.js";
import { ConnectionManager } from "../../packages/main/src/connection-manager.js";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
export function fakeChatGPT(
  options: {
    platform?: string;
    service?: string;
    userData?: string;
    entries?: Map<string, string>;
  } = {},
) {
  const entries = options.entries ?? new Map<string, string>();
  const accesses: string[] = [];
  let unavailable = false;
  let failWrite = "";
  const entry: CredentialEntryFactory = (service, account) => {
    const key = `${service}/${account}`;
    const check = () => {
      accesses.push(key);
      if (unavailable) throw new Error("synthetic-private-provider-error");
    };
    return {
      getPassword: async () => {
        check();
        return entries.get(key) ?? null;
      },
      setPassword: async (value) => {
        check();
        if (failWrite === account) throw new Error("Synthetic write failure.");
        entries.set(key, value);
      },
      deleteCredential: async () => {
        check();
        return entries.delete(key);
      },
    };
  };
  const service = options.service ?? "Ohtia Development synthetic";
  const store = new CredentialStore({
    entry,
    service,
    platform: options.platform ?? "linux",
    userData: options.userData ?? "/unused-synthetic",
  });
  let authorization: URL | undefined;
  let account = "one";
  let client = "client-one";
  let claims: Record<string, unknown> = {};
  let badSignature = false;
  let tokenHeader: Record<string, unknown> = {};
  let exchangeFailure = false;
  let refreshError: string | undefined;
  let refreshStatus = 200;
  let scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  let models: unknown = {
    models: [
      { slug: "first", display_name: "First", visibility: "list" },
      { slug: "hidden", display_name: "Hidden", visibility: "hide" },
      { slug: "second", display_name: "Second", visibility: "list" },
    ],
  };
  let revision = 0;
  let delayRefresh: Promise<void> | undefined;
  const requests: { url: string; body?: URLSearchParams; headers?: HeadersInit }[] = [];
  const request = vi.fn(
    async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const text = String(url);
      const body = init?.body instanceof URLSearchParams ? init.body : undefined;
      requests.push({ url: text, body, headers: init?.headers });
      if (text === chatGPTEndpoints.keys)
        return Response.json({
          keys: [
            { ...publicKey.export({ format: "jwk" }), kid: "synthetic", use: "sig", alg: "RS256" },
          ],
        });
      if (text === chatGPTEndpoints.models) return Response.json(models);
      if (text !== chatGPTEndpoints.token) throw new Error("Unexpected fake request.");
      if (body?.get("grant_type") === "refresh_token") {
        await delayRefresh;
        if (refreshStatus !== 200 || refreshError)
          return Response.json(
            { error: refreshError ?? "temporary" },
            { status: refreshStatus === 200 ? 400 : refreshStatus },
          );
      } else if (exchangeFailure) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "synthetic", ...tokenHeader }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: chatGPTEndpoints.issuer,
          aud: client,
          sub: `subject-${account}`,
          email: `${account}@example.test`,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          nonce: authorization?.searchParams.get("nonce"),
          ...claims,
        }),
      ).toString("base64url");
      const input = `${header}.${payload}`;
      const signature = badSignature
        ? Buffer.from("invalid").toString("base64url")
        : sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
      revision++;
      return Response.json({
        access_token: `access-${account}-${revision}`,
        refresh_token: `refresh-${account}-${revision}`,
        token_type: "Bearer",
        expires_in: 3600,
        scope,
        id_token: `${input}.${signature}`,
      });
    },
  );
  const browser = vi.fn(async (url: string) => {
    authorization = new URL(url);
  });
  const adapter = new ChatGPTProvider({
    store,
    request,
    openBrowser: browser,
    completedText: () => "You can close this tab and return to Ohtia.",
  });
  const diagnostics: unknown[] = [];
  const manager = new ConnectionManager([adapter], (event) => {
    diagnostics.push(event);
  });
  const callback = async (params: Record<string, string> = {}, path = "/auth/callback") => {
    expect(authorization).toBeDefined();
    const url = new URL(authorization!.searchParams.get("redirect_uri")!);
    url.pathname = path;
    url.search = new URLSearchParams({
      state: authorization!.searchParams.get("state")!,
      code: "synthetic-code",
      client_id: client,
      ...params,
    }).toString();
    return fetch(url, { headers: { Connection: "close" } });
  };
  const begin = async (new_registration = false) => {
    browser.mockClear();
    manager.connect("chatgpt", { new_registration });
    await vi.waitFor(() => {
      expect(browser).toHaveBeenCalledOnce();
    });
    return authorization!;
  };
  const login = async (new_registration = false) => {
    await begin(new_registration);
    await callback();
    await vi.waitFor(() => {
      expect(manager.snapshot("chatgpt")?.state).not.toBe("connecting");
    });
    return manager.snapshot("chatgpt")!;
  };
  return {
    entries,
    accesses,
    adapter,
    manager,
    store,
    diagnostics,
    request,
    requests,
    browser,
    begin,
    login,
    callback,
    get authorization() {
      return authorization!;
    },
    set unavailable(v: boolean) {
      unavailable = v;
    },
    set failWrite(v: string) {
      failWrite = v;
    },
    set account(v: string) {
      account = v;
      client = `client-${v}`;
    },
    set claims(v: Record<string, unknown>) {
      claims = v;
    },
    set tokenHeader(v: Record<string, unknown>) {
      tokenHeader = v;
    },
    set badSignature(v: boolean) {
      badSignature = v;
    },
    set exchangeFailure(v: boolean) {
      exchangeFailure = v;
    },
    set scope(v: string) {
      scope = v;
    },
    set refreshError(v: string | undefined) {
      refreshError = v;
    },
    set refreshStatus(v: number) {
      refreshStatus = v;
    },
    set models(v: unknown) {
      models = v;
    },
    set delayRefresh(v: Promise<void>) {
      delayRefresh = v;
    },
    get registration() {
      return entries.get(`${service}/chatgpt-registration`);
    },
    async wait() {
      await vi.waitFor(() => {
        expect(manager.snapshot("chatgpt")?.state).not.toBe("connecting");
      });
    },
  };
}
