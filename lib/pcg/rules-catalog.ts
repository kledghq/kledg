/**
 * Catalogue des règles PCG 2026
 * 
 * Ce fichier contient le catalogue structuré de toutes les règles extraites
 * du document RECEUIL-PCG-2026-AVEC-COUVERTURE.md
 * 
 * Le catalogue est généré par le script rules-extractor.ts
 */

import type { PCGRulesCatalog } from './types'
import { extractPCGRules, saveCatalog, loadCatalog } from './rules-extractor'
import { join } from 'path'
import { logger } from '@/lib/logger'

const CATALOG_PATH = join(process.cwd(), 'lib', 'pcg', 'catalog.json')

/**
 * Charge ou génère le catalogue des règles PCG
 */
export function getPCGRulesCatalog(regenerate: boolean = false): PCGRulesCatalog {
  const fs = require('fs')
  
  // Si le catalogue existe et qu'on ne régénère pas, le charger
  if (!regenerate && fs.existsSync(CATALOG_PATH)) {
    try {
      return loadCatalog(CATALOG_PATH)
    } catch (error) {
      logger.warn('Erreur lors du chargement du catalogue, régénération...', error)
    }
  }
  
  // Sinon, extraire depuis le document
  logger.debug('Extraction des règles PCG 2026...')
  const catalog = extractPCGRules()
  
  // Sauvegarder le catalogue
  saveCatalog(catalog, CATALOG_PATH)
  logger.debug(`Catalogue généré: ${catalog.totalRules} règles (${catalog.regulatoryRules} réglementaires, ${catalog.infraRegulatoryRules} infra-réglementaires)`)
  
  return catalog
}

// Export du catalogue par défaut (sera généré à la première utilisation)
let cachedCatalog: PCGRulesCatalog | null = null

export function getCatalog(): PCGRulesCatalog {
  if (!cachedCatalog) {
    cachedCatalog = getPCGRulesCatalog()
  }
  return cachedCatalog
}
