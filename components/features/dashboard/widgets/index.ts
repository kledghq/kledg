import type { ComponentType } from 'react'

import type { WidgetId } from '@/lib/dashboard/widgets'
import { ProduitsChargesChart, RepartitionChargesChart, TresorerieChart } from './chart-widgets'
import { EcheancesList } from './deadline-widget'
import { GuideWidget } from './guide-widget'
import {
  ARapprocherKpi,
  ChargesKpi,
  ChiffreAffairesKpi,
  CreancesClientsKpi,
  DettesFournisseursKpi,
  MargeKpi,
  ProduitsKpi,
  ResultatKpi,
  TresorerieKpi,
  TvaKpi,
} from './kpi-widgets'
import { ARapprocherList, BrouillonsList, ComptesBancairesList, DernieresEcrituresList, ReglesList } from './list-widgets'
import { CreancesDettesEchuesList } from './aged-balance-widget'
import { BfrKpi, CafKpi, DelaisPaiementKpi, EbeKpi } from './indicator-widgets'
import type { WidgetProps } from './types'

export type { WidgetProps } from './types'
export { guideVisible } from './guide-widget'

/** The renderer of every widget of the registry (lib/dashboard/widgets.ts); the type keeps both lists in step. */
export const WIDGET_COMPONENTS: Record<WidgetId, ComponentType<WidgetProps>> = {
  'guide-demarrer': GuideWidget,
  'kpi-chiffre-affaires': ChiffreAffairesKpi,
  'kpi-produits': ProduitsKpi,
  'kpi-charges': ChargesKpi,
  'kpi-resultat': ResultatKpi,
  'kpi-tresorerie': TresorerieKpi,
  'kpi-a-rapprocher': ARapprocherKpi,
  'kpi-tva': TvaKpi,
  'kpi-marge': MargeKpi,
  'kpi-creances-clients': CreancesClientsKpi,
  'kpi-dettes-fournisseurs': DettesFournisseursKpi,
  'kpi-ebe': EbeKpi,
  'kpi-caf': CafKpi,
  'kpi-bfr': BfrKpi,
  'kpi-delais-paiement': DelaisPaiementKpi,
  'chart-produits-charges': ProduitsChargesChart,
  'chart-tresorerie': TresorerieChart,
  'chart-repartition-charges': RepartitionChargesChart,
  'list-a-rapprocher': ARapprocherList,
  'list-brouillons': BrouillonsList,
  'list-dernieres-ecritures': DernieresEcrituresList,
  'list-comptes-bancaires': ComptesBancairesList,
  'list-creances-dettes-echues': CreancesDettesEchuesList,
  'list-echeances': EcheancesList,
  'list-regles': ReglesList,
}
