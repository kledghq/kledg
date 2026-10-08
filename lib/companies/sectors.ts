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
