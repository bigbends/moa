import type { ReactNode } from "react";

/**
 * Profile pictures drawn in code so they stay crisp at any size and need no
 * licensed artwork. Ids are stored on the profile; unknown ids fall back to
 * the initial-letter tile.
 */
type Eyes = "dot" | "happy" | "wink" | "big" | "sleepy";
type Mouth = "smile" | "open" | "cat" | "tongue" | "o";
interface Spec { id: string; kind: Kind; bg: [string, string]; body: string; accent: string; eyes: Eyes; mouth: Mouth; label: string }
type Kind = "cat" | "bear" | "bunny" | "fox" | "panda" | "penguin" | "frog" | "owl" | "robot" | "ghost" | "alien" | "blob";

const INK = "#231f35";

export const AVATARS: Spec[] = [
  { id: "cat-1", kind: "cat", bg: ["#ffb36b", "#f0603a"], body: "#fff3e4", accent: "#ff9db0", eyes: "dot", mouth: "cat", label: "고양이" },
  { id: "cat-2", kind: "cat", bg: ["#7f8cff", "#4a3bd1"], body: "#3b3650", accent: "#ff9db0", eyes: "big", mouth: "cat", label: "검은 고양이" },
  { id: "bear-1", kind: "bear", bg: ["#9fe3b4", "#2f9e6a"], body: "#b07a4f", accent: "#e8c39e", eyes: "dot", mouth: "smile", label: "곰" },
  { id: "bear-2", kind: "bear", bg: ["#8fd3ff", "#3a7de0"], body: "#f6f4f0", accent: "#ffd6dc", eyes: "happy", mouth: "open", label: "북극곰" },
  { id: "bunny-1", kind: "bunny", bg: ["#ff9fc7", "#e0457f"], body: "#ffffff", accent: "#ffb3c9", eyes: "dot", mouth: "o", label: "토끼" },
  { id: "bunny-2", kind: "bunny", bg: ["#c3b5ff", "#7a5cf0"], body: "#d9b892", accent: "#f7c6cf", eyes: "wink", mouth: "smile", label: "갈색 토끼" },
  { id: "fox-1", kind: "fox", bg: ["#5fd1c6", "#137c86"], body: "#f57b2f", accent: "#fff6ea", eyes: "happy", mouth: "smile", label: "여우" },
  { id: "fox-2", kind: "fox", bg: ["#3c4e8f", "#141d45"], body: "#e9eef7", accent: "#ffffff", eyes: "sleepy", mouth: "cat", label: "눈여우" },
  { id: "panda-1", kind: "panda", bg: ["#a6e57a", "#3f9b35"], body: "#ffffff", accent: INK, eyes: "dot", mouth: "smile", label: "판다" },
  { id: "panda-2", kind: "panda", bg: ["#ffd36b", "#f08a24"], body: "#ffffff", accent: INK, eyes: "happy", mouth: "tongue", label: "웃는 판다" },
  { id: "penguin-1", kind: "penguin", bg: ["#8ee3ff", "#2a8fd6"], body: "#2b3550", accent: "#ffa53a", eyes: "dot", mouth: "smile", label: "펭귄" },
  { id: "penguin-2", kind: "penguin", bg: ["#ff8f8f", "#d23c5b"], body: "#3e2f5b", accent: "#ffc53a", eyes: "wink", mouth: "smile", label: "윙크 펭귄" },
  { id: "frog-1", kind: "frog", bg: ["#ffe08a", "#f2a93b"], body: "#5ccf6a", accent: "#ff8fa3", eyes: "big", mouth: "smile", label: "개구리" },
  { id: "frog-2", kind: "frog", bg: ["#b3a1ff", "#5f45d8"], body: "#41c3a0", accent: "#ff8fa3", eyes: "big", mouth: "tongue", label: "청개구리" },
  { id: "owl-1", kind: "owl", bg: ["#5b6bd8", "#26276e"], body: "#a77b52", accent: "#f2d7b0", eyes: "big", mouth: "smile", label: "부엉이" },
  { id: "owl-2", kind: "owl", bg: ["#ff9e7a", "#cf4b5e"], body: "#e7e2f2", accent: "#ffffff", eyes: "sleepy", mouth: "smile", label: "흰 부엉이" },
  { id: "robot-1", kind: "robot", bg: ["#4ad7ff", "#1d5fd1"], body: "#dfe6f2", accent: "#5cf0d0", eyes: "dot", mouth: "smile", label: "로봇" },
  { id: "robot-2", kind: "robot", bg: ["#ff7aa8", "#9b2fc6"], body: "#ffd23f", accent: "#ff5f8a", eyes: "happy", mouth: "open", label: "노란 로봇" },
  { id: "ghost-1", kind: "ghost", bg: ["#6c5ce7", "#2d1f73"], body: "#ffffff", accent: "#ffb3c9", eyes: "dot", mouth: "o", label: "유령" },
  { id: "ghost-2", kind: "ghost", bg: ["#2fd3a3", "#0c6f73"], body: "#f3eaff", accent: "#ffb3c9", eyes: "wink", mouth: "tongue", label: "장난꾸러기 유령" },
  { id: "alien-1", kind: "alien", bg: ["#2a2f5c", "#0f1230"], body: "#7be495", accent: "#c6ffd3", eyes: "big", mouth: "smile", label: "외계인" },
  { id: "alien-2", kind: "alien", bg: ["#ffcf6e", "#ff7a3d"], body: "#b18cff", accent: "#e3d4ff", eyes: "big", mouth: "o", label: "보라 외계인" },
  { id: "blob-1", kind: "blob", bg: ["#ff8ad8", "#d43b8f"], body: "#7ee0ff", accent: "#ffffff", eyes: "happy", mouth: "open", label: "말랑이" },
  { id: "blob-2", kind: "blob", bg: ["#9be15d", "#2c9c4a"], body: "#ffb347", accent: "#ffffff", eyes: "dot", mouth: "smile", label: "주황 말랑이" }
];

export const AVATAR_GROUPS: { label: string; ids: string[] }[] = [
  { label: "동물", ids: AVATARS.filter(a => !["robot", "ghost", "alien", "blob"].includes(a.kind)).map(a => a.id) },
  { label: "친구들", ids: AVATARS.filter(a => ["robot", "ghost", "alien", "blob"].includes(a.kind)).map(a => a.id) }
];

const byId = new Map(AVATARS.map(a => [a.id, a]));
export const avatarSpec = (id?: string | null) => (id ? byId.get(id) : undefined);
export const randomAvatar = () => AVATARS[Math.floor(Math.random() * AVATARS.length)].id;

function eyes(kind: Eyes, y: number, gap = 11, color = INK): ReactNode {
  const l = 50 - gap, r = 50 + gap;
  const dot = (x: number) => <g key={x}><circle cx={x} cy={y} r="4.2" fill={color} /><circle cx={x + 1.4} cy={y - 1.5} r="1.3" fill="#fff" /></g>;
  const arc = (x: number) => <path key={x} d={`M${x - 4.5} ${y + 1.5}q4.5-6 9 0`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />;
  const big = (x: number) => <g key={x}><circle cx={x} cy={y} r="7.5" fill="#fff" /><circle cx={x + 1} cy={y + .5} r="4.4" fill={color} /><circle cx={x + 2.5} cy={y - 1.3} r="1.5" fill="#fff" /></g>;
  const lid = (x: number) => <path key={x} d={`M${x - 4.5} ${y}q4.5 4.5 9 0`} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />;
  if (kind === "happy") return [arc(l), arc(r)];
  if (kind === "wink") return [dot(l), arc(r)];
  if (kind === "big") return [big(l), big(r)];
  if (kind === "sleepy") return [lid(l), lid(r)];
  return [dot(l), dot(r)];
}

function mouth(kind: Mouth, y: number, color = INK): ReactNode {
  if (kind === "open") return <path d={`M43 ${y}q7 10 14 0z`} fill={color} stroke={color} strokeWidth="2" strokeLinejoin="round" />;
  if (kind === "cat") return <path d={`M44 ${y}q3 3.5 6 0q3 3.5 6 0`} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" />;
  if (kind === "o") return <ellipse cx="50" cy={y + 2} rx="3.4" ry="4" fill={color} />;
  if (kind === "tongue") return <g><path d={`M43 ${y}q7 8 14 0`} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" /><path d={`M51 ${y + 3}q1 6 5 4q2-2 0-6z`} fill="#ff6f8e" /></g>;
  return <path d={`M43.5 ${y}q6.5 7 13 0`} fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />;
}

const cheeks = (y: number, color = "#ff8fa3") => <g opacity=".55"><ellipse cx="31" cy={y} rx="5" ry="3.2" fill={color} /><ellipse cx="69" cy={y} rx="5" ry="3.2" fill={color} /></g>;

function character(a: Spec): ReactNode {
  const { body: b, accent: c } = a;
  switch (a.kind) {
    case "cat": return <>
      <path d="M22 50L25 18l23 17zM78 50l-3-32-23 17z" fill={b} />
      <path d="M27 40l1.5-14 10 8zM73 40l-1.5-14-10 8z" fill={c} />
      <ellipse cx="50" cy="64" rx="33" ry="30" fill={b} />
      {eyes(a.eyes, 60)}<path d="M47.5 66.5h5l-2.5 3z" fill={c} />{mouth(a.mouth, 70)}{cheeks(70, c)}
      <path d="M16 64l10 1M16 71l10-2M84 64l-10 1M84 71l-10-2" stroke={INK} strokeOpacity=".35" strokeWidth="1.6" strokeLinecap="round" />
    </>;
    case "bear": return <>
      <circle cx="25" cy="38" r="12" fill={b} /><circle cx="75" cy="38" r="12" fill={b} />
      <circle cx="25" cy="38" r="6" fill={c} /><circle cx="75" cy="38" r="6" fill={c} />
      <ellipse cx="50" cy="64" rx="33" ry="30" fill={b} />
      <ellipse cx="50" cy="73" rx="14" ry="10.5" fill={c} />
      {eyes(a.eyes, 58, 13)}<ellipse cx="50" cy="68" rx="4.6" ry="3.4" fill={INK} />{mouth(a.mouth, 74)}
    </>;
    case "bunny": return <>
      <ellipse cx="38" cy="26" rx="8" ry="22" fill={b} transform="rotate(-8 38 26)" /><ellipse cx="62" cy="26" rx="8" ry="22" fill={b} transform="rotate(8 62 26)" />
      <ellipse cx="38" cy="27" rx="4" ry="15" fill={c} transform="rotate(-8 38 27)" /><ellipse cx="62" cy="27" rx="4" ry="15" fill={c} transform="rotate(8 62 27)" />
      <ellipse cx="50" cy="68" rx="31" ry="27" fill={b} />
      {eyes(a.eyes, 64)}<ellipse cx="50" cy="71" rx="3" ry="2.2" fill={c} />{mouth(a.mouth, 74)}{cheeks(74, c)}
    </>;
    case "fox": return <>
      <path d="M18 54L22 18l26 20zM82 54l-4-36-26 20z" fill={b} />
      <path d="M24 42l1-15 12 10zM76 42l-1-15-12 10z" fill={INK} fillOpacity=".55" />
      <path d="M50 96c-22 0-36-14-36-32 0-18 16-30 36-30s36 12 36 30c0 18-14 32-36 32z" fill={b} />
      <path d="M14 64c10 2 22 6 36 26 14-20 26-24 36-26-2 18-16 32-36 32S16 82 14 64z" fill={c} />
      {eyes(a.eyes, 60, 13)}<ellipse cx="50" cy="74" rx="4.2" ry="3" fill={INK} />{mouth(a.mouth, 79)}
    </>;
    case "panda": return <>
      <circle cx="24" cy="38" r="11" fill={c} /><circle cx="76" cy="38" r="11" fill={c} />
      <ellipse cx="50" cy="64" rx="33" ry="30" fill={b} />
      <ellipse cx="37" cy="61" rx="8" ry="10" fill={c} transform="rotate(25 37 61)" /><ellipse cx="63" cy="61" rx="8" ry="10" fill={c} transform="rotate(-25 63 61)" />
      {eyes(a.eyes, 60, 13, "#fff")}<ellipse cx="50" cy="71" rx="4.2" ry="3" fill={INK} />{mouth(a.mouth, 76)}{cheeks(76)}
    </>;
    case "penguin": return <>
      <path d="M50 26c22 0 36 18 36 40v30H14V66c0-22 14-40 36-40z" fill={b} />
      <path d="M50 46c-7-9-25-8-27 8-2 14 8 26 27 34 19-8 29-20 27-34-2-16-20-17-27-8z" fill="#fff" />
      {eyes(a.eyes, 60, 10)}<path d="M43 69l7 7 7-7z" fill={c} stroke={c} strokeWidth="2" strokeLinejoin="round" />{cheeks(72)}
    </>;
    case "frog": return <>
      <circle cx="33" cy="42" r="14" fill={b} /><circle cx="67" cy="42" r="14" fill={b} />
      <ellipse cx="50" cy="70" rx="38" ry="26" fill={b} />
      {eyes("big", 41, 17)}
      <path d="M30 72q20 16 40 0" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      {a.mouth === "tongue" && <path d="M52 78q2 9 8 7q3-3-1-9z" fill="#ff6f8e" />}{cheeks(71, c)}
    </>;
    case "owl": return <>
      <path d="M18 44l8-20 14 12M82 44l-8-20-14 12" fill={b} />
      <path d="M50 30c22 0 34 16 34 36v30H16V66c0-20 12-36 34-36z" fill={b} />
      <circle cx="37" cy="60" r="13" fill={c} /><circle cx="63" cy="60" r="13" fill={c} />
      {eyes(a.eyes, 60, 13)}<path d="M45 70h10l-5 8z" fill="#ffb02e" />
      <path d="M36 86q4 3 8 0M48 88q4 3 8 0M56 86q4 3 8 0" fill="none" stroke={INK} strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
    </>;
    case "robot": return <>
      <line x1="50" y1="30" x2="50" y2="16" stroke={b} strokeWidth="3.5" /><circle cx="50" cy="14" r="5" fill={c} />
      <rect x="10" y="52" width="8" height="18" rx="3" fill={b} /><rect x="82" y="52" width="8" height="18" rx="3" fill={b} />
      <rect x="16" y="30" width="68" height="62" rx="18" fill={b} />
      <rect x="25" y="44" width="50" height="36" rx="11" fill={INK} />
      {eyes(a.eyes, 58, 11, c)}{mouth(a.mouth === "open" ? "open" : "smile", 68, c)}
    </>;
    case "ghost": return <>
      <path d="M50 20c-20 0-32 15-32 36v32l8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6V56c0-21-12-36-32-36z" fill={b} />
      {eyes(a.eyes, 54, 11)}{mouth(a.mouth, 64)}{cheeks(64, c)}
      <ellipse cx="30" cy="40" rx="4" ry="7" fill="#fff" opacity=".6" transform="rotate(25 30 40)" />
    </>;
    case "alien": return <>
      <path d="M38 34L30 14M62 34l8-20" stroke={b} strokeWidth="3.5" strokeLinecap="round" /><circle cx="30" cy="13" r="5" fill={c} /><circle cx="70" cy="13" r="5" fill={c} />
      <path d="M50 28c22 0 34 14 34 32 0 20-16 34-34 34S16 80 16 60c0-18 12-32 34-32z" fill={b} />
      <ellipse cx="37" cy="58" rx="9" ry="11" fill={INK} transform="rotate(-20 37 58)" /><ellipse cx="63" cy="58" rx="9" ry="11" fill={INK} transform="rotate(20 63 58)" />
      <circle cx="39" cy="54" r="3" fill="#fff" /><circle cx="65" cy="54" r="3" fill="#fff" />
      {mouth(a.mouth, 76)}
    </>;
    case "blob": return <>
      <path d="M50 20c8 10 34 26 34 50 0 16-14 26-34 26S16 86 16 70c0-24 26-40 34-50z" fill={b} />
      <ellipse cx="34" cy="56" rx="5" ry="9" fill={c} opacity=".7" transform="rotate(30 34 56)" />
      {eyes(a.eyes, 66, 11)}{mouth(a.mouth, 75)}{cheeks(76)}
    </>;
  }
}

export function AvatarArt({ id, title }: { id: string; title?: string }) {
  const a = byId.get(id);
  if (!a) return null;
  const g = `av-bg-${a.id}`;
  return <svg viewBox="0 0 100 100" className="avatar-art" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a.bg[0]} /><stop offset="1" stopColor={a.bg[1]} /></linearGradient></defs>
    <rect width="100" height="100" fill={`url(#${g})`} />
    <circle cx="82" cy="18" r="26" fill="#fff" opacity=".1" />
    <g transform="translate(0 8)">{character(a)}</g>
  </svg>;
}
