import { Amount, StatCard } from '@/components/shared'
import { fromCents, toCents } from '@/lib/utils/money'

interface FixedAssetsStatsProps {
  totalAssets: number
  previousDepreciation: number
  currentDepreciation: number
}

/**
 * Net book value of the assets (valeur nette comptable): acquisition value
 * minus the depreciation already posted, in cents, never below zero.
 */
export function netBookValue({ totalAssets, previousDepreciation, currentDepreciation }: FixedAssetsStatsProps): number {
  const cents = (toCents(totalAssets) ?? 0) - (toCents(previousDepreciation) ?? 0) - (toCents(currentDepreciation) ?? 0)
  return fromCents(Math.max(0, cents))
}

/** Four neutral KPI tiles: these are facts about the assets, not good or bad results. */
export function FixedAssetsStats(props: FixedAssetsStatsProps) {
  const { totalAssets, previousDepreciation, currentDepreciation } = props
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Valeur d'acquisition"
        value={<Amount value={totalAssets} />}
        hint="Total des immobilisations enregistrées"
      />
      <StatCard
        label="Amortissements antérieurs"
        value={<Amount value={previousDepreciation} />}
        hint="Cumul des exercices précédents"
      />
      <StatCard
        label="Dotation de l'exercice"
        value={<Amount value={currentDepreciation} />}
        hint="Amortissement de l'exercice en cours"
      />
      <StatCard
        label="Valeur nette comptable"
        value={<Amount value={netBookValue(props)} />}
        hint="Valeur d'acquisition moins les amortissements"
      />
    </div>
  )
}
