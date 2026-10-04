"use client"

import * as React from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  date?: Date
  onDateChange: (date: Date | undefined) => void
  placeholder?: string
  className?: string
  id?: string
  disabled?: boolean
}

export function DatePicker({
  date,
  onDateChange,
  placeholder = "Sélectionner une date",
  className,
  id,
  disabled = false,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open && !disabled} onOpenChange={(open) => !disabled && setOpen(open)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          data-empty={!date}
          disabled={disabled}
          className={cn(
            "data-[empty=true]:text-muted-foreground w-full justify-start text-left font-normal",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date && !isNaN(date.getTime()) ? format(date, "PPP", { locale: fr }) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          onSelect={(selectedDate) => {
            onDateChange(selectedDate)
            setOpen(false)
          }}
          initialFocus
          locale={fr}
        />
      </PopoverContent>
    </Popover>
  )
}

interface DatePickerWithRangeProps {
  date?: DateRange
  onDateChange?: (date: DateRange | undefined) => void
  className?: string
  disabled?: boolean
  /** Id of the trigger, for a label (`<Field>` sets it). */
  id?: string
  placeholder?: string
}

/** "Du 01/01/2026 au 31/12/2026" (docs/design-system.md, periods), from the local days picked. */
export function formatDateRange(range: DateRange | undefined): string {
  const day = (date: Date) => format(date, "dd/MM/yyyy")
  if (!range?.from) return ""
  return range.to ? `Du ${day(range.from)} au ${day(range.to)}` : `À partir du ${day(range.from)}`
}

export function DatePickerWithRange({
  date,
  onDateChange,
  className,
  disabled = false,
  id,
  placeholder = "Sélectionner une période",
  ...props
}: DatePickerWithRangeProps & Pick<React.ComponentProps<"button">, "aria-describedby" | "aria-invalid" | "aria-required">) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open && !disabled} onOpenChange={(open) => !disabled && setOpen(open)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date?.from && "text-muted-foreground",
            className
          )}
          {...props}
        >
          <CalendarIcon aria-hidden />
          <span className="num truncate">{date?.from ? formatDateRange(date) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={date?.from}
          selected={date}
          onSelect={onDateChange}
          numberOfMonths={2}
          locale={fr}
        />
      </PopoverContent>
    </Popover>
  )
}
