import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Minus, Plus } from 'lucide-react';
import { useDismiss } from '../lib/hooks.ts';

export function Stepper(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { label, value, min, max, onChange } = props;
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus size={14} />
      </button>
      <span className="stepper-value">
        <b>{value}</b>
        <small>{label}</small>
      </span>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`switch-row${props.disabled ? ' disabled' : ''}`}>
      <span className="switch-text">
        <span>{props.label}</span>
        {props.hint && <small>{props.hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`switch${props.checked ? ' on' : ''}`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented small" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Floating panel anchored to an element, rendered in a portal. */
export function Popover(props: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const { anchor, open, onClose, placement = 'top', className = '', children } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useDismiss(open, onClose, ref, anchor);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const m = 8;
      let left: number;
      let top: number;
      let side = placement;
      if (side === 'top' && a.top - h - m < 0) side = 'bottom';
      else if (side === 'bottom' && a.bottom + h + m > vh) side = 'top';
      if (side === 'left' && a.left - w - m < 0) side = 'right';
      else if (side === 'right' && a.right + w + m > vw) side = 'left';
      if (side === 'top' || side === 'bottom') {
        left = a.left + a.width / 2 - w / 2;
        top = side === 'top' ? a.top - h - m : a.bottom + m;
      } else {
        top = a.top + a.height / 2 - h / 2;
        left = side === 'left' ? a.left - w - m : a.right + m;
      }
      left = Math.max(m, Math.min(vw - w - m, left));
      top = Math.max(m, Math.min(vh - h - m, top));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, placement]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem(props: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={props.checked}
      className={`menu-item${props.danger ? ' danger' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="menu-icon">{props.icon}</span>
      <span className="menu-label">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
      {props.checked !== undefined && <span className="menu-check">{props.checked && <Check size={15} />}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-section">{children}</div>;
}

export function MenuDivider() {
  return <div className="menu-divider" role="separator" />;
}
