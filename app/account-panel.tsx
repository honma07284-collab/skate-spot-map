"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Check, LogIn, LogOut, UserRoundPlus, X } from "lucide-react";
import { AVATARS, authEmailForUsername, isSupabaseConfigured, Profile, supabase } from "./supabase";

type AccountPanelProps = {
  open: boolean;
  user: User | null;
  profile: Profile | null;
  localSpotCount: number;
  onClose: () => void;
  onProfileChange: (profile: Profile) => void;
  onImportLocal: () => Promise<void>;
};

type RequestRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
};

type FriendshipRow = { user_a: string; user_b: string };
type FriendProfile = Pick<Profile, "id" | "username" | "avatar">;

type SocialState = {
  friends: FriendProfile[];
  incoming: (RequestRow & { profile: FriendProfile })[];
  outgoing: (RequestRow & { profile: FriendProfile })[];
};

const EMPTY_SOCIAL_STATE: SocialState = { friends: [], incoming: [], outgoing: [] };

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "処理に失敗しました。もう一度お試しください";

  const message = error.message.toLowerCase();
  if (message.includes("email rate limit exceeded")) {
    return "確認メールの送信上限に達しました。SupabaseのAuthentication設定でEmail確認をOFFにしてから、時間をおいて再試行してください。";
  }
  if (message.includes("email not confirmed")) {
    return "このIDはメール確認待ちです。SupabaseのAuthentication設定でEmail確認をOFFにするか、Supabase側でこのユーザーを確認済みにしてください。";
  }
  if (message.includes("user already registered")) {
    return "このIDはすでに登録されています。ログインを試すか、別のIDを使ってください。";
  }
  if (message.includes("invalid login credentials")) {
    return "IDまたはパスワードが違います。入力を確認してください。";
  }

  return error.message;
}

export default function AccountPanel({
  open,
  user,
  profile,
  localSpotCount,
  onClose,
  onProfileChange,
  onImportLocal,
}: AccountPanelProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [view, setView] = useState<"profile" | "friends">("profile");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newAvatar, setNewAvatar] = useState<(typeof AVATARS)[number]>(AVATARS[0]);
  const [searchId, setSearchId] = useState("");
  const [social, setSocial] = useState(EMPTY_SOCIAL_STATE);
  const [socialRevision, setSocialRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadedSocialKey, setLoadedSocialKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const socialKey = user ? `${user.id}:${socialRevision}` : "";
  const loadingSocial = open && Boolean(user) && view === "friends" && socialKey !== loadedSocialKey;

  useEffect(() => {
    if (!open || !user || view !== "friends" || !supabase) return;
    const activeUser = user;
    let cancelled = false;

    async function loadSocialData() {
      const [friendshipsResult, requestsResult] = await Promise.all([
        supabase!.from("friendships").select("user_a,user_b"),
        supabase!.from("friend_requests").select("id,requester_id,addressee_id"),
      ]);
      if (friendshipsResult.error) throw friendshipsResult.error;
      if (requestsResult.error) throw requestsResult.error;

      const friendshipRows = (friendshipsResult.data ?? []) as FriendshipRow[];
      const requestRows = (requestsResult.data ?? []) as RequestRow[];
      const friendIds = friendshipRows.map((row) => row.user_a === activeUser.id ? row.user_b : row.user_a);
      const otherIds = [...new Set(requestRows.map((row) => row.requester_id === activeUser.id ? row.addressee_id : row.requester_id))];
      const profileIds = [...new Set([...friendIds, ...otherIds])];
      const profileResult = profileIds.length
        ? await supabase!.from("profiles").select("id,username,avatar").in("id", profileIds)
        : { data: [], error: null };
      if (profileResult.error) throw profileResult.error;
      const profiles = (profileResult.data ?? []) as FriendProfile[];
      const byId = new Map(profiles.map((item) => [item.id, item]));

      return {
        friends: friendIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
        incoming: requestRows.flatMap((row) => row.addressee_id === activeUser.id && byId.has(row.requester_id)
          ? [{ ...row, profile: byId.get(row.requester_id)! }]
          : []),
        outgoing: requestRows.flatMap((row) => row.requester_id === activeUser.id && byId.has(row.addressee_id)
          ? [{ ...row, profile: byId.get(row.addressee_id)! }]
          : []),
      } satisfies SocialState;
    }

    loadSocialData()
      .then((nextSocial) => {
        if (!cancelled) {
          setSocial(nextSocial);
          setError("");
          setLoadedSocialKey(`${activeUser.id}:${socialRevision}`);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(loadError));
          setLoadedSocialKey(`${activeUser.id}:${socialRevision}`);
        }
      });

    return () => { cancelled = true; };
  }, [open, user, view, socialRevision]);

  if (!open) return null;

  function closePanel() {
    setError("");
    setMessage("");
    onClose();
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      setError("IDは半角英小文字・数字・_ の3〜20文字で入力してください");
      return;
    }
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmailForUsername(normalizedUsername),
          password,
          options: { data: { username: normalizedUsername, avatar: newAvatar } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("SupabaseのEmail確認をOFFにすると、このIDとパスワードでログインできます。");
          return;
        }
        setMessage("アカウントを作成しました");
        closePanel();
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: authEmailForUsername(normalizedUsername),
          password,
        });
        if (signInError) throw signInError;
        closePanel();
      }
    } catch (authError) {
      setError(getErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  }

  function refreshSocial() {
    setView("friends");
    setSocial(EMPTY_SOCIAL_STATE);
    setSocialRevision((revision) => revision + 1);
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !searchId.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { error: requestError } = await supabase.rpc("send_friend_request", {
      target_username: searchId.trim().toLowerCase(),
    });
    setBusy(false);
    if (requestError) {
      setError(requestError.message);
      return;
    }
    setSearchId("");
    setMessage("友達申請を送りました");
    setSocial(EMPTY_SOCIAL_STATE);
    setSocialRevision((revision) => revision + 1);
  }

  async function respondToRequest(requestId: string, accept: boolean) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    const { error: responseError } = await supabase.rpc("respond_to_friend_request", {
      request_id: requestId,
      accept_request: accept,
    });
    setBusy(false);
    if (responseError) {
      setError(responseError.message);
      return;
    }
    setSocial(EMPTY_SOCIAL_STATE);
    setSocialRevision((revision) => revision + 1);
  }

  async function cancelRequest(requestId: string) {
    if (!supabase) return;
    setBusy(true);
    const { error: cancelError } = await supabase.from("friend_requests").delete().eq("id", requestId);
    setBusy(false);
    if (cancelError) setError(cancelError.message);
    else {
      setSocial(EMPTY_SOCIAL_STATE);
      setSocialRevision((revision) => revision + 1);
    }
  }

  async function removeFriend(friendId: string) {
    if (!supabase) return;
    setBusy(true);
    const { error: removeError } = await supabase.rpc("remove_friend", { friend_user_id: friendId });
    setBusy(false);
    if (removeError) setError(removeError.message);
    else {
      setSocial(EMPTY_SOCIAL_STATE);
      setSocialRevision((revision) => revision + 1);
    }
  }

  async function chooseAvatar(avatar: (typeof AVATARS)[number]) {
    if (!supabase || !user || !profile) return;
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase.from("profiles").update({ avatar }).eq("id", user.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onProfileChange({ ...profile, avatar });
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut();
    setBusy(false);
    if (signOutError) setError(signOutError.message);
    else closePanel();
  }

  async function importLocalSpots() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onImportLocal();
      setMessage("この端末のスポットをアカウントに移行しました");
    } catch (importError) {
      setError(getErrorMessage(importError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closePanel();
    }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header className="account-header">
          <div>
            <span className="section-index">ROLL CALL / ACCOUNT</span>
            <h2 id="account-title">{user ? "アカウント" : mode === "signup" ? "新規登録" : "ログイン"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={closePanel} aria-label="閉じる"><X size={18} /></button>
        </header>

        {!isSupabaseConfigured ? (
          <div className="account-content">
            <p className="account-notice">アカウント機能を使うにはSupabaseの接続設定が必要です。READMEの設定手順を完了すると、IDログインとスポット共有が有効になります。</p>
          </div>
        ) : user ? (
          <>
            <nav className="account-tabs" aria-label="アカウントメニュー">
              <button type="button" className={view === "profile" ? "is-active" : ""} onClick={() => setView("profile")}>プロフィール</button>
              <button type="button" className={view === "friends" ? "is-active" : ""} onClick={refreshSocial}>友達 <span>{social.incoming.length || ""}</span></button>
            </nav>
            <div className="account-content">
              {view === "profile" ? (
                <>
                  <div className="profile-summary">
                    <span className="profile-avatar">{profile?.avatar ?? "🛹"}</span>
                    <div><strong>@{profile?.username ?? "読み込み中"}</strong><span>あなたのID</span></div>
                  </div>
                  <span className="field-label">アイコン</span>
                  <div className="avatar-options" aria-label="プロフィールアイコン">
                    {AVATARS.map((avatar) => (
                      <button key={avatar} type="button" className={`avatar-option${profile?.avatar === avatar ? " is-active" : ""}`} onClick={() => void chooseAvatar(avatar)} disabled={busy} aria-label={`${avatar}を選択`} aria-pressed={profile?.avatar === avatar}>{avatar}</button>
                    ))}
                  </div>
                  {localSpotCount > 0 && (
                    <div className="migration-row">
                      <div><strong>この端末のスポット</strong><span>{localSpotCount}件をアカウントに移行</span></div>
                      <button className="secondary-button" type="button" onClick={() => void importLocalSpots()} disabled={busy}>移行する</button>
                    </div>
                  )}
                  <button className="signout-button" type="button" onClick={() => void signOut()} disabled={busy}><LogOut size={16} />ログアウト</button>
                </>
              ) : (
                <>
                  <form className="friend-search" onSubmit={sendRequest}>
                    <label className="field-label" htmlFor="friend-id">友達のID</label>
                    <div><input id="friend-id" className="text-input" value={searchId} onChange={(event) => setSearchId(event.target.value.toLowerCase())} placeholder="例: roll_skater" maxLength={20} /><button className="primary-button" type="submit" disabled={busy || !searchId.trim()} aria-label="友達申請を送る"><UserRoundPlus size={17} /></button></div>
                    <span className="form-hint">IDを正確に入力して申請します</span>
                  </form>

                  <div className="friend-section">
                    <div className="friend-section-heading"><strong>届いた申請</strong><span>{social.incoming.length}</span></div>
                    {loadingSocial ? <p className="friend-empty">読み込み中...</p> : social.incoming.length ? social.incoming.map((request) => (
                      <div className="friend-row" key={request.id}>
                        <span className="friend-avatar">{request.profile.avatar}</span><strong>@{request.profile.username}</strong>
                        <button className="friend-action friend-action--accept" type="button" onClick={() => void respondToRequest(request.id, true)} disabled={busy} aria-label={`${request.profile.username}を承認`} title="承認"><Check size={16} /></button>
                        <button className="friend-action" type="button" onClick={() => void respondToRequest(request.id, false)} disabled={busy} aria-label={`${request.profile.username}を拒否`} title="拒否"><X size={16} /></button>
                      </div>
                    )) : <p className="friend-empty">新しい申請はありません</p>}
                  </div>

                  <div className="friend-section">
                    <div className="friend-section-heading"><strong>友達</strong><span>{social.friends.length}</span></div>
                    {loadingSocial ? <p className="friend-empty">読み込み中...</p> : social.friends.length ? social.friends.map((friend) => (
                      <div className="friend-row" key={friend.id}>
                        <span className="friend-avatar">{friend.avatar}</span><strong>@{friend.username}</strong>
                        <button className="friend-remove" type="button" onClick={() => void removeFriend(friend.id)} disabled={busy}>解除</button>
                      </div>
                    )) : <p className="friend-empty">承認した友達がここに表示されます</p>}
                  </div>

                  {social.outgoing.length > 0 && <div className="friend-section">
                    <div className="friend-section-heading"><strong>送った申請</strong><span>{social.outgoing.length}</span></div>
                    {social.outgoing.map((request) => <div className="friend-row" key={request.id}>
                      <span className="friend-avatar">{request.profile.avatar}</span><strong>@{request.profile.username}</strong>
                      <button className="friend-remove" type="button" onClick={() => void cancelRequest(request.id)} disabled={busy}>取消</button>
                    </div>)}
                  </div>}
                </>
              )}
              {message && <p className="account-message" role="status">{message}</p>}
              {error && <p className="account-error" role="alert">{error}</p>}
            </div>
          </>
        ) : (
          <div className="account-content">
            <p className="account-intro">スポットを端末間で同期し、承認した友達と共有できます。</p>
            <form className="account-form" onSubmit={submitAuth}>
              <label className="field-label" htmlFor="account-username">ID</label>
              <input id="account-username" className="text-input" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="半角英小文字・数字・_" maxLength={20} required />
              <label className="field-label" htmlFor="account-password">パスワード</label>
              <input id="account-password" className="text-input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
              {mode === "signup" && <>
                <span className="field-label">アイコン</span>
                <div className="avatar-options" aria-label="プロフィールアイコン">
                  {AVATARS.map((avatar) => <button key={avatar} type="button" className={`avatar-option${newAvatar === avatar ? " is-active" : ""}`} onClick={() => setNewAvatar(avatar)} aria-label={`${avatar}を選択`} aria-pressed={newAvatar === avatar}>{avatar}</button>)}
                </div>
              </>}
              <button className="primary-button account-submit" type="submit" disabled={busy}>{mode === "signup" ? <UserRoundPlus size={17} /> : <LogIn size={17} />}{busy ? "処理中..." : mode === "signup" ? "IDを作成" : "ログイン"}</button>
            </form>
            <button className="account-switch" type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setMessage(""); }}>
              {mode === "signup" ? "すでにアカウントをお持ちですか？ ログイン" : "はじめて使う方 新規登録"}
            </button>
            {message && <p className="account-message" role="status">{message}</p>}
            {error && <p className="account-error" role="alert">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
