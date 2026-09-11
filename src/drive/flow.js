// 授權：Chrome Extension 類型的 OAuth client + chrome.identity.getAuthToken。
//
// 為什麼不是 PKCE + launchWebAuthFlow：Google 的「Web application」client 屬於 confidential
// client，token endpoint 強制要 client_secret（實測錯誤：invalid_request, client_secret is
// missing），而 secret 不能放進 extension。Chrome 官方指定的做法是 Chrome Extension client
// type + getAuthToken，由 Chrome 代管 token 的取得、快取與續期。
// https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
//
// 副作用：使用的 Google 帳號 = 目前登入 Chrome 的帳號，不另外選；scope 寫在 manifest 的 oauth2。
import { DriveAuthError } from "./client.js";
import { DRIVE_SCOPE } from "./config.js";

const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** getAuthToken 在不同 Chrome 版本可能回字串或 { token, grantedScopes }。 */
function normalize(result) {
  if (typeof result === "string") return { token: result, grantedScopes: null };
  if (result && typeof result.token === "string") return { token: result.token, grantedScopes: result.grantedScopes ?? null };
  throw new DriveAuthError("chrome.identity 沒有回傳 token");
}

export function createDriveAuth({ identity = globalThis.chrome?.identity, scopes = [DRIVE_SCOPE], fetchFn = fetch } = {}) {
  if (typeof identity?.getAuthToken !== "function") throw new TypeError("需要 chrome.identity.getAuthToken");

  async function token(interactive) {
    return normalize(await identity.getAuthToken({ interactive, scopes }));
  }

  return Object.freeze({
    /** 互動式：會彈 Google 的帳號 / 同意畫面。 */
    async connect() {
      let got;
      try {
        got = await token(true);
      } catch (e) {
        throw new DriveAuthError(`授權未完成：${e?.message ?? String(e)}`, { cause: e });
      }
      // 使用者可以在同意畫面取消個別 scope；沒拿到就當失敗，不要等到呼叫 API 才 403
      if (got.grantedScopes && !scopes.every((s) => got.grantedScopes.includes(s))) {
        await identity.removeCachedAuthToken?.({ token: got.token });
        throw new DriveAuthError(`未取得必要權限 ${scopes.join(", ")}，請重新授權並保留 drive.file 勾選`);
      }
      return { connected: true };
    },

    /** 非互動式：給 Drive client 用。Chrome 會自動續期，過期時這裡就會拿到新的。 */
    async getAccessToken() {
      try {
        return (await token(false)).token;
      } catch (e) {
        throw new DriveAuthError(`尚未連結 Google Drive（${e?.message ?? String(e)}），請在設定頁按「連結 Google Drive」。`, { cause: e });
      }
    },

    /** API 回 401 時呼叫：把失效的 token 踢出 Chrome 快取，下次才會拿到新的。 */
    async invalidate(badToken) {
      if (badToken) await identity.removeCachedAuthToken?.({ token: badToken });
    },

    async disconnect() {
      let current = null;
      try {
        current = (await token(false)).token;
      } catch {
        /* 本來就沒授權 */
      }
      if (current) {
        try {
          await fetchFn(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(current)}`, { method: "POST" });
        } catch {
          /* 撤銷失敗不能擋住本機清除，否則會卡在假的「已連結」 */
        }
        await identity.removeCachedAuthToken?.({ token: current });
      }
      await identity.clearAllCachedAuthTokens?.();
      return { connected: false };
    },

    async status() {
      try {
        await token(false);
        return { connected: true };
      } catch {
        return { connected: false };
      }
    },
  });
}
