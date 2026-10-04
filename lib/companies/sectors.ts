/**
 * Coefficients de valorisation par secteur d'activité
 * Ces coefficients sont basés sur les standards du marché français
 */

export type Sector = 
  | 'tech' 
  | 'retail' 
  | 'services' 
  | 'manufacturing' 
  | 'real-estate' 
  | 'finance' 
  | 'healthcare' 
  | 'consulting'
  | 'construction'
  | 'hospitality'
  | 'transport'
  | 'education'
  | 'agriculture'
  | 'energy'
  | 'media'
  | 'craft'
  | 'wholesale'
  | 'automotive'
  | 'fashion'
  | 'publishing'
  | 'other'

export interface SectorMultipliers {
  caMultiple: {
    min: number
    max: number
    default: number
  }
  ebitdaMultiple: {
    min: number
    max: number
    default: number
  }
  liquidationDiscount: number // Décote pour valeur de liquidation (0-1)
}

/**
 * Coefficients de valorisation par secteur
 */
export const SECTOR_MULTIPLIERS: Record<Sector, SectorMultipliers> = {
  tech: {
    caMultiple: { min: 1.5, max: 5.0, default: 2.5 },
    ebitdaMultiple: { min: 8.0, max: 20.0, default: 12.0 },
    liquidationDiscount: 0.5, // 50% de décote (actifs intangibles)
  },
  retail: {
    caMultiple: { min: 0.3, max: 1.0, default: 0.6 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.2, // 20% de décote
  },
  services: {
    caMultiple: { min: 0.5, max: 2.0, default: 1.0 },
    ebitdaMultiple: { min: 4.0, max: 10.0, default: 6.0 },
    liquidationDiscount: 0.3, // 30% de décote
  },
  manufacturing: {
    caMultiple: { min: 0.4, max: 1.5, default: 0.8 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.25, // 25% de décote
  },
  'real-estate': {
    caMultiple: { min: 0.2, max: 0.8, default: 0.5 },
    ebitdaMultiple: { min: 5.0, max: 15.0, default: 10.0 },
    liquidationDiscount: 0.1, // 10% de décote (actifs immobiliers)
  },
  finance: {
    caMultiple: { min: 0.5, max: 2.0, default: 1.0 },
    ebitdaMultiple: { min: 5.0, max: 12.0, default: 8.0 },
    liquidationDiscount: 0.2, // 20% de décote
  },
  healthcare: {
    caMultiple: { min: 0.8, max: 2.5, default: 1.5 },
    ebitdaMultiple: { min: 6.0, max: 15.0, default: 10.0 },
    liquidationDiscount: 0.3, // 30% de décote
  },
  consulting: {
    caMultiple: { min: 0.8, max: 2.0, default: 1.2 },
    ebitdaMultiple: { min: 5.0, max: 12.0, default: 8.0 },
    liquidationDiscount: 0.4, // 40% de décote (peu d'actifs)
  },
  construction: {
    caMultiple: { min: 0.3, max: 1.0, default: 0.6 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.3, // 30% de décote
  },
  hospitality: {
    caMultiple: { min: 0.4, max: 1.2, default: 0.8 },
    ebitdaMultiple: { min: 4.0, max: 10.0, default: 6.0 },
    liquidationDiscount: 0.25, // 25% de décote
  },
  transport: {
    caMultiple: { min: 0.3, max: 1.0, default: 0.6 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.3, // 30% de décote (véhicules)
  },
  education: {
    caMultiple: { min: 0.5, max: 1.5, default: 1.0 },
    ebitdaMultiple: { min: 4.0, max: 10.0, default: 6.0 },
    liquidationDiscount: 0.4, // 40% de décote (peu d'actifs)
  },
  agriculture: {
    caMultiple: { min: 0.4, max: 1.2, default: 0.8 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.2, // 20% de décote (terres, équipements)
  },
  energy: {
    caMultiple: { min: 0.5, max: 1.5, default: 1.0 },
    ebitdaMultiple: { min: 5.0, max: 12.0, default: 8.0 },
    liquidationDiscount: 0.2, // 20% de décote (infrastructures)
  },
  media: {
    caMultiple: { min: 0.8, max: 2.5, default: 1.5 },
    ebitdaMultiple: { min: 5.0, max: 15.0, default: 10.0 },
    liquidationDiscount: 0.4, // 40% de décote (contenu intangible)
  },
  craft: {
    caMultiple: { min: 0.4, max: 1.2, default: 0.8 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.3, // 30% de décote
  },
  wholesale: {
    caMultiple: { min: 0.2, max: 0.8, default: 0.5 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.25, // 25% de décote (stocks)
  },
  automotive: {
    caMultiple: { min: 0.3, max: 1.0, default: 0.6 },
    ebitdaMultiple: { min: 3.0, max: 8.0, default: 5.0 },
    liquidationDiscount: 0.3, // 30% de décote
  },
  fashion: {
    caMultiple: { min: 0.5, max: 1.5, default: 1.0 },
    ebitdaMultiple: { min: 4.0, max: 10.0, default: 6.0 },
    liquidationDiscount: 0.35, // 35% de décote (stocks, marque)
  },
  publishing: {
    caMultiple: { min: 0.6, max: 1.8, default: 1.2 },
    ebitdaMultiple: { min: 4.0, max: 12.0, default: 8.0 },
    liquidationDiscount: 0.4, // 40% de décote (contenu)
  },
  other: {
    caMultiple: { min: 0.5, max: 1.5, default: 1.0 },
    ebitdaMultiple: { min: 4.0, max: 10.0, default: 6.0 },
    liquidationDiscount: 0.3, // 30% de décote par défaut
  },
}

/**
 * Liste des secteurs disponibles
 */
export const SECTOR_OPTIONS: Array<{ value: Sector; label: string }> = [
  { value: 'tech', label: 'Technologie / IT' },
  { value: 'retail', label: 'Commerce de détail' },
  { value: 'services', label: 'Services' },
  { value: 'manufacturing', label: 'Industrie / Manufacturing' },
  { value: 'real-estate', label: 'Immobilier' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Santé' },
  { value: 'consulting', label: 'Conseil' },
  { value: 'construction', label: 'BTP / Construction' },
  { value: 'hospitality', label: 'Hôtellerie / Restauration' },
  { value: 'transport', label: 'Transport / Logistique' },
  { value: 'education', label: 'Éducation / Formation' },
  { value: 'agriculture', label: 'Agriculture / Agroalimentaire' },
  { value: 'energy', label: 'Énergie / Environnement' },
  { value: 'media', label: 'Communication / Média' },
  { value: 'craft', label: 'Artisanat' },
  { value: 'wholesale', label: 'Distribution / Grossiste' },
  { value: 'automotive', label: 'Automobile' },
  { value: 'fashion', label: 'Textile / Mode' },
  { value: 'publishing', label: 'Édition / Presse' },
  { value: 'other', label: 'Autre' },
]
