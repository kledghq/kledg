/** The TanStack Table features each table of the app uses (v9 tree-shakes the rest). */

import { columnSizingFeature, columnVisibilityFeature, rowSelectionFeature, tableFeatures } from '@tanstack/react-table'

/** Accounting entries: selectable rows, visible cells. */
export const selectableRowsFeatures = tableFeatures({ rowSelectionFeature, columnVisibilityFeature })

/** Bank transactions: selectable rows, a "Colonnes" menu and fixed column widths. */
export const transactionTableFeatures = tableFeatures({ rowSelectionFeature, columnVisibilityFeature, columnSizingFeature })
export type TransactionTableFeatures = typeof transactionTableFeatures
