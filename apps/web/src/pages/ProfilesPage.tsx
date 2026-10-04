import { Check, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Profile } from "@moa/shared";
import { keys, useProfiles } from "../api/queries";
import { Avatar, Logo } from "../components/AppShell";
import { AVATAR_GROUPS, AvatarArt, avatarSpec, randomAvatar } from "../components/avatars";
import { Button, Skeleton } from "../components/ui";
import { api, ApiError, currentProfileId, setCurrentProfileId } from "../lib/api";
import { cx } from "../lib/format";

const MAX_PROFILES = 5;

function AvatarPicker({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return <div className="avatar-picker">
    {AVATAR_GROUPS.map(group => <section key={group.label} aria-label={group.label}>
      <h3>{group.label}</h3>
      <div className="avatar-picker-grid" role="radiogroup" aria-label={group.label}>
        {group.ids.map(id => <button type="button" key={id} role="radio" aria-checked={id === value} aria-label={avatarSpec(id)?.label} className={cx("avatar-choice", id === value && "is-active")} onClick={() => onPick(id)}>
          <AvatarArt id={id} />
          {id === value && <Check size={18} className="avatar-choice-check" aria-hidden="true" />}
        </button>)}
      </div>
    </section>)}
  </div>;
}

function ProfileEditor({ profile, onDone, onCancel, onDelete }: { profile?: Profile; onDone: (profile: Profile) => void; onCancel?: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState(() => profile?.avatar && avatarSpec(profile.avatar) ? profile.avatar : randomAvatar());
  const [kids, setKids] = useState(profile?.kids ?? false);
  const [picking, setPicking] = useState(!profile);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    const body = { name: name.trim(), avatar, kids };
    try { onDone(await api<Profile>(profile ? `/profiles/${encodeURIComponent(profile.id)}` : "/profiles", { method: profile ? "PATCH" : "POST", body })); }
    catch (e) { setError(e instanceof ApiError && e.code === "profile-limit" ? `프로필은 계정당 ${MAX_PROFILES}개까지 만들 수 있어요.` : "저장하지 못했어요. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!profile) return;
    setBusy(true);
    try { await api(`/profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE" }); onDelete?.(); }
    catch { setError("삭제하지 못했어요. 다시 시도해 주세요."); setBusy(false); }
  };
  return (
    <form className="profile-editor" onSubmit={submit}>
      <button type="button" className="profile-editor-avatar" aria-expanded={picking} aria-label="프로필 이미지 바꾸기" onClick={() => setPicking(v => !v)}>
        <Avatar profile={{ name: name || "?", color: "violet", avatar }} size={120} />
        <span className="profile-editor-pencil" aria-hidden="true"><Pencil size={16} /></span>
      </button>
      {picking && <AvatarPicker value={avatar} onPick={id => setAvatar(id)} />}
      <input autoFocus={!!profile} value={name} maxLength={20} placeholder="이름" aria-label="프로필 이름" onChange={event => setName(event.target.value)} />
      <label className="profile-kids">
        <span><b>어린이 프로필</b><small>12세 이하 등급이거나 가족·키즈 장르인 작품만 보여요.</small></span>
        <button type="button" role="switch" aria-checked={kids} aria-label="어린이 프로필" className={cx("switch", kids && "is-on")} onClick={() => setKids(v => !v)}><i /></button>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="profile-create-actions">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>취소</Button>}
        <Button type="submit" variant="primary" disabled={!name.trim() || busy}>{profile ? "저장" : "만들기"}</Button>
      </div>
      {profile && onDelete && (confirmDelete
        ? <p className="profile-delete-confirm">이어보기와 내 목록도 함께 지워져요. <button type="button" className="text-btn btn-danger" disabled={busy} onClick={remove}>삭제</button> <button type="button" className="text-btn" onClick={() => setConfirmDelete(false)}>취소</button></p>
        : <button type="button" className="text-btn btn-danger" onClick={() => setConfirmDelete(true)}>프로필 삭제</button>)}
    </form>
  );
}

export function ProfilesPage() {
  const profiles = useProfiles();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  const enter = (profile: Profile) => {
    setCurrentProfileId(profile.id);
    client.clear();
    navigate("/", { replace: true });
  };
  const refresh = () => client.invalidateQueries({ queryKey: keys.profiles });

  const list = profiles.data ?? [];
  const showCreate = creating || (profiles.isSuccess && list.length === 0);

  if (editing) return (
    <div className="profiles">
      <div className="profiles-logo"><Logo /></div>
      <h1>프로필 편집</h1>
      <ProfileEditor key={editing.id} profile={editing}
        onDone={() => { void refresh(); setEditing(null); }}
        onCancel={() => setEditing(null)}
        onDelete={list.length > 1 ? () => { if (currentProfileId() === editing.id) setCurrentProfileId(null); void refresh(); setEditing(null); } : undefined} />
    </div>
  );

  return (
    <div className="profiles">
      <div className="profiles-logo"><Logo /></div>
      {showCreate ? (
        <>
          <h1>{list.length ? "새 프로필" : "MOA에 오신 것을 환영합니다"}</h1>
          <p className="profiles-sub">프로필마다 이어보기와 내 목록이 따로 저장됩니다.</p>
          <ProfileEditor onDone={profile => { void refresh(); enter(profile); }} onCancel={list.length ? () => setCreating(false) : undefined} />
        </>
      ) : (
        <>
          <h1>{managing ? "프로필 관리" : "누가 보나요?"}</h1>
          <ul className={cx("profile-grid", managing && "is-managing")}>
            {profiles.isPending && Array.from({ length: 2 }, (_, i) => <li key={i}><Skeleton className="profile-sk" /></li>)}
            {list.map(profile => (
              <li key={profile.id}>
                <button className="profile-tile" aria-label={managing ? `${profile.name} 편집` : undefined} onClick={() => managing ? setEditing(profile) : enter(profile)}>
                  <span className="profile-tile-art">
                    <Avatar profile={profile} size={112} />
                    {managing && <span className="profile-tile-edit" aria-hidden="true"><Pencil size={30} /></span>}
                  </span>
                  <span>{profile.name}</span>
                </button>
              </li>
            ))}
            {profiles.isSuccess && !managing && list.length < MAX_PROFILES && (
              <li>
                <button className="profile-tile profile-add" onClick={() => setCreating(true)}>
                  <span className="avatar profile-add-icon"><Plus size={44} /></span>
                  <span>프로필 추가</span>
                </button>
              </li>
            )}
          </ul>
          {profiles.isSuccess && <Button variant={managing ? "primary" : "ghost"} className="profiles-manage" onClick={() => setManaging(v => !v)}>{managing ? "완료" : "프로필 관리"}</Button>}
          {profiles.isError && <p className="form-error">서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>}
        </>
      )}
    </div>
  );
}
