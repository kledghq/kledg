/**
 * Classes of the account ledger tables (grand livre of an account, latest
 * entries of the account page). Under 56rem of container width (phones, and
 * tablets or small laptops with the sidebar open) each line becomes a stacked
 * card on the same markup: date, journal and piece number with the action on
 * the first line, the label on the second, then the debit or credit and the
 * running balance, each named by its `data-label`. Wider containers keep the
 * table. Put `LEDGER.container` on an element around the table. The grouped
 * reports (livre-journal, grand livre) add title, total and spacer rows.
 *
 * Full class strings on purpose: Tailwind only generates classes it finds
 * written out in the source.
 */
export const LEDGER = {
  container: '@container/ledger',
  table: '@max-[56rem]/ledger:block @max-[56rem]/ledger:[&>tbody]:block @max-[56rem]/ledger:[&>tfoot]:block',
  /** Header row: the cards carry their own labels. */
  header: '@max-[56rem]/ledger:hidden',
  /** Scroll container of a long table: no inner vertical scroll once stacked. */
  scroll: '@max-[56rem]/ledger:max-h-none',
  row: '@max-[56rem]/ledger:flex @max-[56rem]/ledger:flex-wrap @max-[56rem]/ledger:items-center @max-[56rem]/ledger:gap-x-3 @max-[56rem]/ledger:gap-y-1 @max-[56rem]/ledger:px-3 @max-[56rem]/ledger:py-2.5',
  date: '@max-[56rem]/ledger:order-1 @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:font-medium',
  journal: '@max-[56rem]/ledger:order-2 @max-[56rem]/ledger:p-0',
  piece: '@max-[56rem]/ledger:order-3 @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:text-muted-foreground',
  action: '@max-[56rem]/ledger:order-4 @max-[56rem]/ledger:ml-auto @max-[56rem]/ledger:p-0',
  label: '@max-[56rem]/ledger:order-5 @max-[56rem]/ledger:w-full @max-[56rem]/ledger:max-w-none @max-[56rem]/ledger:p-0',
  /**
   * Debit and credit: an empty side disappears from the card, whether the
   * cell is empty or keeps a dash for the table and carries `data-empty`.
   */
  amount:
    '@max-[56rem]/ledger:order-6 @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:empty:hidden @max-[56rem]/ledger:data-empty:hidden @max-[56rem]/ledger:before:mr-1.5 @max-[56rem]/ledger:before:text-xs @max-[56rem]/ledger:before:font-normal @max-[56rem]/ledger:before:text-muted-foreground @max-[56rem]/ledger:before:content-[attr(data-label)]',
  balance:
    '@max-[56rem]/ledger:order-7 @max-[56rem]/ledger:ml-auto @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:before:mr-1.5 @max-[56rem]/ledger:before:text-xs @max-[56rem]/ledger:before:font-normal @max-[56rem]/ledger:before:text-muted-foreground @max-[56rem]/ledger:before:content-[attr(data-label)]',
  /** Footer: "Total" on its own line, then the labelled totals. */
  totalLabel: '@max-[56rem]/ledger:w-full @max-[56rem]/ledger:p-0',
  hidden: '@max-[56rem]/ledger:hidden',

  /*
   * Grouped reports (livre-journal, grand livre): title rows, rows that
   * continue a card, total rows and spacers, on the same container.
   */
  /** Full-width cell of a group title row (journal, account): wraps. */
  title: '@max-[56rem]/ledger:w-full @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:whitespace-normal',
  /** A row followed by more rows of the same card: no separator under it. */
  joined: '@max-[56rem]/ledger:border-b-0',
  /** Row nested in a card (lines of an entry): indented under its header. */
  nested: '@max-[56rem]/ledger:pl-6',
  /** Text that wraps once stacked instead of overflowing the card. */
  wrap: '@max-[56rem]/ledger:whitespace-normal @max-[56rem]/ledger:break-words',
  /** Account of an entry line: on its own line, first. */
  account:
    '@max-[56rem]/ledger:order-1 @max-[56rem]/ledger:w-full @max-[56rem]/ledger:max-w-none @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:whitespace-normal @max-[56rem]/ledger:break-words',
  /** Label of an entry line: takes the room left of its amount. */
  lineLabel:
    '@max-[56rem]/ledger:order-2 @max-[56rem]/ledger:min-w-0 @max-[56rem]/ledger:max-w-none @max-[56rem]/ledger:flex-1 @max-[56rem]/ledger:p-0 @max-[56rem]/ledger:whitespace-normal @max-[56rem]/ledger:break-words',
  /** Total row: its label on the first line, labelled amounts aligned right under it. */
  totalRow: '@max-[56rem]/ledger:justify-end',
  /** Label of a total row once stacked: left aligned, wraps. */
  totalText: '@max-[56rem]/ledger:text-left @max-[56rem]/ledger:whitespace-normal',
  /** Spacer row between cards or groups: a gap, no padding. */
  spacer: '@max-[56rem]/ledger:block @max-[56rem]/ledger:[&>td]:block @max-[56rem]/ledger:[&>td]:p-0',
} as const
