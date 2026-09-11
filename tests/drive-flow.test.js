// 授權狀態機（chrome.identity.getAuthToken 版）。
// Chrome Extension 類型的 OAuth client 是 public client：token 由 Chrome 取得與快取，
// extension 不碰 token endpoint、不需要 client_secret，也沒有自己的 refresh token 要管。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDriveAuth } from "../src/drive/flow.js";
import { DriveAuthError } from "../src/drive/client.js";

/** 假的 chrome.identity。token 以佇列提供，失敗用 Error。 */
function fakeIdentity({ tokens = [], removed = [], cleared = { n: 0 } } = {}) {
  const calls = [];
  return {
    calls,
    removed,
    cleared,
    getAuthToken: async (opts) => {
      calls.push(opts);
      const next = tokens.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("OAuth2 not granted or revoked.");
      return next;
    },
    removeCachedAuthToken: async ({ token }) => {
      removed.push(token);
    },
    clearAllCachedAuthTokens: async () => {
      cleared.n++;
    },
  };
}

const okRes = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" });

function setup(identity, { fetchFn = async () => okRes() } = {}) {
  const fetched = [];
  const wrapped = async (url, init) => {
    fetched.push(String(url));
    return fetchFn(url, init);
  };
  return { auth: createDriveAuth({ identity, fetchFn: wrapped }), identity, fetched };
}

test("connect：互動式取得 token", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [{ token: "AT", grantedScopes: ["https://www.googleapis.com/auth/drive.file"] }] }));
  const r = await auth.connect();
  assert.equal(r.connected, true);
  assert.equal(identity.calls[0].interactive, true);
  assert.deepEqual(identity.calls[0].scopes, ["https://www.googleapis.com/auth/drive.file"]);
});

test("connect：也接受舊式直接回字串的 getAuthToken", async () => {
  const { auth } = setup(fakeIdentity({ tokens: ["AT"] }));
  assert.equal((await auth.connect()).connected, true);
});

test("connect：使用者取消 → DriveAuthError，訊息帶原因", async () => {
  const { auth } = setup(fakeIdentity({ tokens: [new Error("The user did not approve access.")] }));
  await assert.rejects(() => auth.connect(), (e) => e instanceof DriveAuthError && /did not approve/.test(e.message));
});

test("connect：Google 沒給到要求的 scope → 視為失敗，不要事後才在 API 撞 403", async () => {
  const { auth } = setup(fakeIdentity({ tokens: [{ token: "AT", grantedScopes: ["https://www.googleapis.com/auth/userinfo.email"] }] }));
  await assert.rejects(() => auth.connect(), (e) => e instanceof DriveAuthError && /drive\.file/.test(e.message));
});

test("getAccessToken：非互動式取得，不會自己彈視窗", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [{ token: "AT" }] }));
  assert.equal(await auth.getAccessToken(), "AT");
  assert.equal(identity.calls[0].interactive, false);
});

test("getAccessToken：尚未授權 → DriveAuthError 且訊息要指向「連結」按鈕", async () => {
  const { auth } = setup(fakeIdentity({ tokens: [new Error("OAuth2 not granted or revoked.")] }));
  await assert.rejects(() => auth.getAccessToken(), (e) => e instanceof DriveAuthError && /連結 Google Drive/.test(e.message));
});

test("invalidate：把壞掉的 token 從 Chrome 快取移除（401 之後要能重取）", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [] }));
  await auth.invalidate("BAD");
  assert.deepEqual(identity.removed, ["BAD"]);
});

test("disconnect：撤銷 + 清掉 Chrome 快取", async () => {
  const { auth, identity, fetched } = setup(fakeIdentity({ tokens: [{ token: "AT" }] }));
  await auth.disconnect();
  assert.match(fetched[0], /^https:\/\/oauth2\.googleapis\.com\/revoke\?token=AT/);
  assert.deepEqual(identity.removed, ["AT"]);
  assert.equal(identity.cleared.n, 1);
});

test("disconnect：本來就沒 token 也不能丟錯", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [new Error("not granted")] }));
  assert.deepEqual(await auth.disconnect(), { connected: false });
  assert.equal(identity.cleared.n, 1);
});

test("disconnect：撤銷請求失敗仍要清掉本機快取", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [{ token: "AT" }] }), {
    fetchFn: async () => {
      throw new TypeError("offline");
    },
  });
  await auth.disconnect();
  assert.deepEqual(identity.removed, ["AT"]);
  assert.equal(identity.cleared.n, 1);
});

test("status：以非互動式取 token 判斷是否已連結", async () => {
  const yes = setup(fakeIdentity({ tokens: [{ token: "AT" }] }));
  assert.deepEqual(await yes.auth.status(), { connected: true });
  const no = setup(fakeIdentity({ tokens: [new Error("not granted")] }));
  assert.deepEqual(await no.auth.status(), { connected: false });
});

test("status 不可彈出授權視窗（popup 開著時會被 Chrome 擋掉並汙染狀態）", async () => {
  const { auth, identity } = setup(fakeIdentity({ tokens: [{ token: "AT" }] }));
  await auth.status();
  assert.equal(identity.calls[0].interactive, false);
});

test("缺 chrome.identity 直接丟 TypeError", () => {
  assert.throws(() => createDriveAuth({ identity: {} }), TypeError);
});
