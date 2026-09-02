"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type UiSelectOption = { value: string; label: string; disabled?: boolean; color?: string };

type UiSelectProps = {
  value: string | number;
  options: UiSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
};

export default function UiSelect({ value, options, onChange, ariaLabel, disabled = false, className = "", onOpenChange }: UiSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const stringValue = String(value);
  const selected = options.find((option) => option.value === stringValue) ?? options[0];

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const openMenu = () => {
    if (disabled || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 148);
    const estimatedHeight = Math.min(268, options.length * 36 + 12);
    const top = rect.bottom + 6 + estimatedHeight > window.innerHeight
      ? Math.max(8, rect.top - estimatedHeight - 6)
      : rect.bottom + 6;
    setMenuStyle({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, width });
    changeOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) changeOpen(false);
    };
    const closeOnViewportChange = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      changeOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [changeOpen, open]);

  const select = (option: UiSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    changeOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") { changeOpen(false); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) changeOpen(false);
      else openMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === stringValue);
    const next = event.key === "ArrowDown"
      ? enabled[(index + 1 + enabled.length) % enabled.length]
      : enabled[(index - 1 + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };

  return <div data-ui-select className={`ui-select ${className}`} onWheel={(event) => event.stopPropagation()}>
    <button ref={triggerRef} type="button" role="combobox" className={`ui-select__trigger ${selected?.color ? "has-option-color" : ""}`} style={selected?.color ? { background: selected.color } : undefined} aria-label={ariaLabel} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" disabled={disabled} onClick={() => open ? changeOpen(false) : openMenu()} onKeyDown={onKeyDown}><span>{selected?.label ?? "選択"}</span><ChevronDown size={13} /></button>
    {open && createPortal(<div ref={menuRef} id={listId} className="ui-select__menu" role="listbox" aria-label={ariaLabel} style={menuStyle} onWheel={(event) => event.stopPropagation()}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === stringValue} disabled={option.disabled} className={`${option.value === stringValue ? "is-selected" : ""} ${option.color ? "has-option-color" : ""}`} style={option.color ? { background: option.color } : undefined} key={option.value} onClick={() => select(option)}><span>{option.label}</span>{option.value === stringValue && <Check size={13} />}</button>)}</div>, document.body)}
  </div>;
}
