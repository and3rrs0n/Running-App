import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      className={cx('card p-4', onClick && 'cursor-pointer transition active:scale-[0.99] active:bg-raised', className)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="label">{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="pt-safe px-4 pb-2">
      <div className="flex items-end justify-between gap-3 pt-3">
        <div className="min-w-0">
          {subtitle && <div className="text-[13px] font-medium text-muted">{subtitle}</div>}
          <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight">{title}</h1>
        </div>
        {right}
      </div>
    </header>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="animate-fade absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="animate-sheet relative mx-auto flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-3xl border-t border-line bg-[#111419]"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <div className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line" />
          <h3 className="mt-3 text-[17px] font-semibold">{title}</h3>
          <button aria-label="Lukk" onClick={onClose} className="mt-3 rounded-full bg-raised p-2 text-muted active:bg-line">
            <X size={18} />
          </button>
        </div>
        <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-[#111419] px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex rounded-xl border border-line bg-surface p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 rounded-lg px-2 py-2 text-[13px] font-semibold transition',
            value === o.value ? 'bg-raised text-ink shadow' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  active,
  children,
  onClick,
  color,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition',
        active ? 'border-transparent bg-ink text-bg' : 'border-line bg-surface text-muted',
      )}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {hint && <span className="text-[12px] text-dim">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <div>
        <div className="text-[15px]">{label}</div>
        {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{sub}</div>}
      </div>
      <span
        className={cx(
          'relative h-[30px] w-[50px] shrink-0 rounded-full transition',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all',
            checked ? 'left-[23px]' : 'left-[3px]',
          )}
        />
      </span>
    </button>
  );
}

export function ProgressBar({ value, max, color = '#3ee0a1', className, marker }: { value: number; max: number; color?: string; className?: string; marker?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('relative h-2 w-full overflow-hidden rounded-full bg-line', className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      {marker !== undefined && max > 0 && (
        <div className="absolute top-0 h-full w-0.5 bg-ink/70" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />
      )}
    </div>
  );
}

export function Ring({ value, max, size = 84, stroke = 8, color = '#3ee0a1', children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#262b33" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className="num mt-1 text-[22px] font-semibold leading-none tracking-tight">
        {value}
        {unit && <span className="ml-1 text-[13px] font-medium text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-dim">{icon}</div>}
      <div className="font-semibold">{title}</div>
      {body && <p className="mt-1 max-w-xs text-[14px] leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({ children, color = '#8b93a1', className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', className)}
      style={{ color, background: color + '1f' }}
    >
      {children}
    </span>
  );
}

export function ScaleInput({
  value,
  onChange,
  min,
  max,
  colorFor,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  min: number;
  max: number;
  colorFor?: (v: number) => string;
}) {
  const vals = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${vals.length}, minmax(0, 1fr))` }}>
      {vals.map((v) => {
        const active = value === v;
        const c = colorFor ? colorFor(v) : '#3ee0a1';
        return (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={cx(
              'num h-10 rounded-lg border text-[14px] font-semibold transition',
              active ? 'border-transparent text-bg' : 'border-line bg-raised text-muted',
            )}
            style={active ? { background: c } : undefined}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

export function painColor(v: number) {
  if (v === 0) return '#3ee0a1';
  if (v <= 2) return '#a6e36b';
  if (v <= 4) return '#f5b452';
  return '#ff6b6b';
}

export function rpeColor(v: number) {
  if (v <= 3) return '#3ee0a1';
  if (v <= 5) return '#a6e36b';
  if (v <= 7) return '#f5b452';
  return '#ff6b6b';
}
