/**
 * French labels of the group view, shared by the page, the exports and the
 * MCP tools. Pure, no runtime imports: usable in client components.
 */

import type { FlowCategory, KeyFigures } from './combine'
import type { ParticipationKind } from './periods'

export const FLOW_CATEGORY_LABELS: Record<FlowCategory, string> = {
  management_fee: 'Frais de gestion',
  invoice: 'Facture entre sociétés du groupe',
  dividend: 'Dividendes (761)',
  current_account: 'Compte courant (451, 455)',
  trade: 'Créance ou dette commerciale (40, 41)',
  loan: 'Prêt ou avance (267, 168)',
}

export const PARTICIPATION_KIND_LABELS: Record<ParticipationKind, string> = {
  filiale: 'Filiale (plus de 50 %)',
  participation: 'Participation (10 à 50 %)',
  autre: 'Moins de 10 %',
}

export const FIGURE_ROWS: Array<{ key: keyof KeyFigures; label: string; hint: string }> = [
  { key: 'chiffreAffairesCents', label: "Chiffre d'affaires", hint: 'Comptes 70' },
  { key: 'ebeCents', label: "Excédent brut d'exploitation", hint: 'Soldes intermédiaires de gestion' },
  { key: 'resultatCents', label: "Résultat de l'exercice", hint: 'Produits moins charges' },
  { key: 'tresorerieCents', label: 'Trésorerie', hint: 'Solde des comptes 512 en fin de période' },
  { key: 'capitauxPropresCents', label: 'Capitaux propres', hint: 'Résultat compris' },
  { key: 'endettementCents', label: 'Endettement financier', hint: 'Emprunts et dettes financières, hors découverts' },
  { key: 'totalBilanCents', label: 'Total du bilan', hint: 'Actif net, égal au passif' },
]

export const INDICATIVE_NOTICE =
  'Vue combinée indicative : addition des comptes des sociétés lisibles et élimination des flux intragroupe trouvés. Ce ne sont pas des comptes consolidés (règlement ANC 2020-01, Code de commerce art. L233-16 et L233-17) : pas de part des minoritaires, titres de participation non éliminés.'
