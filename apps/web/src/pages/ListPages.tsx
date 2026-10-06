import { GroupedSearch } from '../components/GroupedFeed';
import { hasLoginGate } from "../lib/api";
import { Bookmark, ChevronRight, FolderOpen, History, LogOut, Puzzle, Search as SearchIcon, Settings, Subtitles, Users, UsersRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSources } from "./SourcesPage";
import { keys, useHistory, useMe, useProfiles, useSearch, useWatchlist } from "../api/queries";
import { PosterCard } from "../components/Cards";
import { Avatar } from "../components/AppShell";
import { logout } from "./AccountsPage";
import { Artwork } from "../components/Artwork";
import { Button, EmptyState, ProgressBar, Skeleton } from "../components/ui";
import { api, currentProfileId, setCurrentProfileId } from "../lib/api";
import { clock } from "../lib/format";
import { settledQuery, useSettledQuery } from "../lib/search-input";

function GridSkeleton({ count = 12 }: { count?: number }) {
  return <div className="grid" aria-hidden="true">{Array.from({ length: count }, (_, i) => <div key={i} className="card poster-card"><Skeleton className="art art-poster" /><Skeleton className="sk-text" style={{ width: "70%", marginTop: 10 }} /></div>)}</div>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [value, setValue] = useState(q);
  const result = useSearch(q);
  const sources = useSources();
  const installed = sources.data?.filter(s => s.enabled) || [];
  const input = useRef<HTMLInputElement>(null);

  // Mobile has no search box in the header; this one mirrors the URL (without eating a space being typed).
  useEffect(() => { setValue(value => settledQuery(value) === q ? value : q); }, [q]);
  const commit = (query: string) => setParams(query ? { q: query } : {}, { replace: true });
  useSettledQuery(value, q, commit);

  const groups = result.data?.groups.filter(group => group.items.length || group.error) ?? [];
  return (
    <div className="page-pad search-page">
      <div className="searchbox searchbox-page">
        <SearchIcon size={20} aria-hidden="true" />
        <input ref={input} type="search" value={value} placeholder="제목, 장르 검색" aria-label="검색" onChange={event => setValue(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { const query = settledQuery(event.currentTarget.value); if (query !== q) commit(query); } }} />
        {value && <button className="searchbox-clear" aria-label="지우기" onClick={() => { setValue(""); commit(""); input.current?.focus(); }}><X size={18} /></button>}
      </div>
      {!q && <EmptyState icon={<SearchIcon size={40} />} title="무엇을 볼까요?" body="내 라이브러리와 설치된 소스에서 한 번에 찾습니다." />}
      {q && result.isSuccess && !groups.length && !installed.length && <EmptyState title={`'${q}'에 대한 결과가 없습니다`} body="다른 제목이나 원제로 검색해 보세요." />}
      {q && <GroupedSearch key={q} sources={installed} query={q} local={groups.flatMap(g=>g.items)} pending={result.isPending || sources.isPending}/>}

    </div>
  );
}

export function MyListPage() {
  const list = useWatchlist();
  const navigate = useNavigate();
  return (
    <div className="page-pad">
      <header className="page-head"><h1>내 목록</h1></header>
      {list.isPending && <GridSkeleton />}
      {list.data?.length === 0 && <EmptyState icon={<Bookmark size={40} />} title="아직 담은 작품이 없습니다" body="작품 상세 화면에서 '내 목록'을 누르면 여기에 모입니다." action={<Button variant="primary" onClick={() => navigate("/")}>둘러보기</Button>} />}
      {!!list.data?.length && <div className="grid">{list.data.map(card => <PosterCard key={card.id} card={card} />)}</div>}
    </div>
  );
}

export function HistoryPage() {
  const history = useHistory();
  const client = useQueryClient();
  const remove = async (episodeId: string) => {
    await api(`/history/${encodeURIComponent(episodeId)}`, { method: "DELETE" });
    void client.invalidateQueries({ queryKey: keys.history });
    void client.invalidateQueries({ queryKey: ["home"] });
  };
  const items = history.data?.items ?? [];
  return (
    <div className="page-pad">
      <header className="page-head"><h1>시청 기록</h1></header>
      {history.isPending && <div className="history-list">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="history-sk" />)}</div>}
      {history.isSuccess && !items.length && <EmptyState icon={<History size={40} />} title="시청 기록이 없습니다" />}
      <ul className="history-list">
        {items.map(entry => {
          const p = entry.episode.progress;
          return (
            <li key={entry.episode.id} className="history-item">
              <Link to={`/watch/${encodeURIComponent(entry.episode.id)}`} className="history-thumb">
                <Artwork src={entry.episode.thumb ?? entry.media.backdrop} title={entry.media.title} ratio="landscape" width={320} labelFallback={false} />
                {p && <ProgressBar ratio={p.completed ? 1 : p.position / Math.max(1, p.duration)} className="card-progress" />}
              </Link>
              <Link to={`/title/${encodeURIComponent(entry.media.id)}`} className="history-body">
                <b>{entry.media.title}</b>
                <span>{entry.media.type === "movie" ? "" : `${entry.episode.title} · `}{p?.completed ? "시청 완료" : p ? `${clock(p.position)} / ${clock(p.duration)}` : ""}</span>
                <small>{new Date(entry.watchedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
              </Link>
              <button className="icon-btn" aria-label="기록에서 삭제" title="기록에서 삭제" onClick={() => void remove(entry.episode.id)}><X size={18} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mobile "마이" tab: profile, shortcuts to history / library / settings. */
export function MePage() {
  const profiles = useProfiles();
  const navigate = useNavigate();
  const profile = profiles.data?.find(item => item.id === currentProfileId());
  const me = useMe();
  const admin = me.data?.role === "admin";
  const link = (to: string, icon: React.ReactNode, label: string) => (
    <Link to={to} className="me-link">{icon}<span>{label}</span><ChevronRight size={18} /></Link>
  );
  return (
    <div className="page-pad me-page">
      <div className="me-head"><Avatar profile={profile} size={64} /><div><b>{profile?.name}</b><button className="text-btn" onClick={() => { setCurrentProfileId(null); navigate("/profiles"); }}><UsersRound size={14} />프로필 전환</button></div></div>
      <nav className="me-links">
        {link("/history", <History size={20} />, "시청 기록")}
        {link("/my-list", <Bookmark size={20} />, "내 목록")}
        {admin && link("/sources", <FolderOpen size={20} />, "영상 소스")}
        {admin && link("/library", <FolderOpen size={20} />, "라이브러리 관리")}
        {link("/plugins", <Puzzle size={20} />, "플러그인")}
        {admin && link("/subtitles", <Subtitles size={20} />, "저장한 자막")}
        {admin && hasLoginGate && link("/accounts", <Users size={20} />, "계정과 초대")}
        {link("/settings", <Settings size={20} />, "설정")}
        {hasLoginGate && <button className="me-link" onClick={() => void logout()}><LogOut size={20} /><span>로그아웃{me.data && <small> · {me.data.username}</small>}</span><ChevronRight size={18} /></button>}
      </nav>
    </div>
  );
}
