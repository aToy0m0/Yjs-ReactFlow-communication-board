"use client"

import { useState } from "react"
import { ja } from "date-fns/locale"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type DatePickerProps = {
  ariaLabel: string
  value: string
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (value: string) => void
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function DatePicker({ ariaLabel, value, disabled = false, onOpenChange, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseDate(value)
  const changeOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" className="database-date-picker nodrag nowheel" aria-label={ariaLabel} disabled={disabled} />}
      >
        <span>{selected ? dateValue(selected).replaceAll("-", "/") : "未設定"}</span>
        <CalendarDays />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        positionMethod="fixed"
        className="database-date-picker__popover w-auto p-0"
      >
        <Calendar
          mode="single"
          required
          locale={ja}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return
            onChange(dateValue(date))
            changeOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
