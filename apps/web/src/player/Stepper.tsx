import { Minus, Plus } from "lucide-react";

export function Stepper({ label, unit, value, min, max, onChange }: { label: string; unit: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return <div className="pf-block">
    <span className="pf-label">{label}</span>
    <div className="stepper">
      <button type="button" aria-label={`${label} 줄이기`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}><Minus size={16} /></button>
      <label><input inputMode="numeric" aria-label={label} value={value} onChange={e => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || 0))} /><span>{unit}</span></label>
      <button type="button" aria-label={`${label} 늘리기`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}><Plus size={16} /></button>
    </div>
  </div>;
}
