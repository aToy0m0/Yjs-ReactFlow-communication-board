"use client";

import { Minus, Plus } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type NumericStepperProps = {
  value: number;
  min: number;
  max: number;
  ariaLabel: string;
  onChange: (value: number) => void;
};

export default function NumericStepper({ value, min, max, ariaLabel, onChange }: NumericStepperProps) {
  const dragRef = useRef<{ y: number; value: number } | null>(null);
  const normalize = (next: number) => Math.max(min, Math.min(max, Math.round(next)));
  const change = (next: number) => onChange(normalize(next));

  return <div className="numeric-stepper flex items-center gap-2">
    <Button size="icon-sm" variant="outline" type="button" aria-label={`${ariaLabel}を1減らす`} onClick={() => change(value - 1)} disabled={value <= min}><Minus /></Button>
    <Input className="h-8 min-w-0 text-center tabular-nums"
      aria-label={ariaLabel}
      inputMode="numeric"
      value={value}
      onChange={(event) => { if (/^-?\d*$/.test(event.target.value) && event.target.value !== "" && event.target.value !== "-") change(Number(event.target.value)); }}
      onPointerDown={(event) => { dragRef.current = { y: event.clientY, value }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (!dragRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return; change(dragRef.current.value + Math.trunc((dragRef.current.y - event.clientY) / 12)); }}
      onPointerUp={() => { dragRef.current = null; }}
      title="上下ドラッグでも1ずつ変更できます"
    />
    <Button size="icon-sm" variant="outline" type="button" aria-label={`${ariaLabel}を1増やす`} onClick={() => change(value + 1)} disabled={value >= max}><Plus /></Button>
  </div>;
}
