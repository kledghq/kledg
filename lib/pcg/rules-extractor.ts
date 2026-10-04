/**
 * Extracteur de règles PCG 2026 depuis le document markdown
 * 
 * Parse le document RECEUIL-PCG-2026-AVEC-COUVERTURE.md et extrait
 * toutes les règles réglementaires (articles en noir) et infra-réglementaires
 * (commentaires en bleu) pour créer un catalogue structuré.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import type { PCGRule, PCGRuleCategory, PCGRulesCatalog } from './types'

interface ParsedArticle {
  articleNumber: string
  type: 'regulatory' | 'infra-regulatory'
  title: string
  content: string
  category: PCGRuleCategory
  pageNumber?: number
  lineNumber?: number
}

/**
 * Extrait les règles PCG depuis le document markdown
 */
export function extractPCGRules(
  documentPath: string = join(process.cwd(), 'ref', 'RECEUIL-PCG-2026-AVEC-COUVERTURE.md')
): PCGRulesCatalog {
  const content = readFileSync(documentPath, 'utf-8')
  const lines = content.split('\n')
  
  const rules: PCGRule[] = []
  const currentCategory: PCGRuleCategory = {
    book: 'I',
    title: '',
    chapter: '',
    section: '',
  }
  
  let currentPageNumber: number | undefined
  let i = 0
  
  while (i < lines.length) {
    const line = lines[i]
    
    // Détecter les numéros de page
    const pageMatch = line.match(/page-(\d+)-/)
    if (pageMatch) {
      currentPageNumber = parseInt(pageMatch[1], 10)
    }
    
    // Détecter les livres
    const bookMatch = line.match(/^# .*Livre ([IVX]+) :/i)
    if (bookMatch) {
      const bookRoman = bookMatch[1]
      const bookMap: Record<string, 'I' | 'II' | 'III' | 'IV' | 'V'> = {
        'I': 'I',
        'II': 'II',
        'III': 'III',
        'IV': 'IV',
        'V': 'V',
      }
      currentCategory.book = bookMap[bookRoman] || 'I'
    }
    
    // Détecter les titres
    const titleMatch = line.match(/^## .*Titre ([IVX]+), (.+)$/i)
    if (titleMatch) {
      currentCategory.title = titleMatch[2].trim()
    }
    
    // Détecter les chapitres
    const chapterMatch = line.match(/^## .*Chapitre ([IVX]+), (.+)$/i)
    if (chapterMatch) {
      currentCategory.chapter = chapterMatch[2].trim()
    }
    
    // Détecter les sections
    const sectionMatch = line.match(/^## .*Section (\d+), (.+)$/i)
    if (sectionMatch) {
      currentCategory.section = sectionMatch[2].trim()
      currentCategory.subsection = undefined
    }
    
    // Détecter les sous-sections
    const subsectionMatch = line.match(/^### .*Sous-section (\d+), (.+)$/i)
    if (subsectionMatch) {
      currentCategory.subsection = subsectionMatch[2].trim()
    }
    
    // Détecter les articles réglementaires (format: ## **Art. XXX-YY**)
    const regulatoryArticleMatch = line.match(/^## \*\*Art\. (\d+-\d+)\*\*/)
    if (regulatoryArticleMatch) {
      const articleNumber = regulatoryArticleMatch[1]
      const article = parseArticle(
        lines,
        i,
        articleNumber,
        'regulatory',
        currentCategory,
        currentPageNumber
      )
      if (article) {
        rules.push(article)
        i = article.lineNumber || i + 1
        continue
      }
    }
    
    // Détecter les articles infra-réglementaires (format: ### IR X - ... ou #### IR X - ...)
    const infraRegulatoryMatch = line.match(/^#{3,4} (IR\s*\d+|IR\s*\d+-\d+) - (.+)$/i)
    if (infraRegulatoryMatch) {
      // "IR 3" or "IR3-1": the number without its "IR" prefix (ids "IR3-211-1")
      const irNumber = infraRegulatoryMatch[1].replace(/^IR/i, '').replace(/\s+/g, '')
      const title = infraRegulatoryMatch[2].trim()
      const article = parseInfraRegulatoryArticle(
        lines,
        i,
        irNumber,
        title,
        currentCategory,
        currentPageNumber
      )
      if (article) {
        rules.push(article)
        i = article.lineNumber || i + 1
        continue
      }
    }
    
    i++
  }
  
  // Organiser les règles par catégorie
  const rulesByCategory: Record<string, PCGRule[]> = {}
  const rulesByArticle: Record<string, PCGRule> = {}
  
  for (const rule of rules) {
    const categoryKey = `${rule.category.book}-${rule.category.title}-${rule.category.chapter}`
    if (!rulesByCategory[categoryKey]) {
      rulesByCategory[categoryKey] = []
    }
    rulesByCategory[categoryKey].push(rule)
    rulesByArticle[rule.id] = rule
  }
  
  const regulatoryCount = rules.filter(r => r.type === 'regulatory').length
  const infraRegulatoryCount = rules.filter(r => r.type === 'infra-regulatory').length
  
  return {
    version: '2026',
    extractionDate: new Date(),
    totalRules: rules.length,
    regulatoryRules: regulatoryCount,
    infraRegulatoryRules: infraRegulatoryCount,
    rules,
    rulesByCategory,
    rulesByArticle,
  }
}

/**
 * Parse un article réglementaire
 */
function parseArticle(
  lines: string[],
  startIndex: number,
  articleNumber: string,
  type: 'regulatory',
  category: PCGRuleCategory,
  pageNumber?: number
): PCGRule | null {
  let content = ''
  let i = startIndex + 1
  let title = ''
  
  // Lire jusqu'à la prochaine section/article
  while (i < lines.length) {
    const line = lines[i].trim()
    
    // Arrêter si on rencontre un nouvel article ou une nouvelle section
    if (
      line.match(/^## \*\*Art\./) ||
      line.match(/^#{2,3} .*Section/) ||
      line.match(/^#{2,3} .*Chapitre/) ||
      line.match(/^#{2,3} .*Titre/) ||
      (line.startsWith('#') && i > startIndex + 5)
    ) {
      break
    }
    
    // Ignorer les lignes vides au début
    if (content === '' && line === '') {
      i++
      continue
    }
    
    // Extraire le titre si présent (première ligne non vide après l'article)
    if (title === '' && line && !line.match(/^#{1,6}/) && !line.match(/^Art\./)) {
      // Le titre peut être sur la même ligne que l'article ou la suivante
      if (line.length < 200) {
        title = line
      }
    }
    
    content += line + '\n'
    i++
  }
  
  if (!content.trim()) {
    return null
  }
  
  // Nettoyer le contenu
  content = content.trim()
  
  // Extraire les critères de validation et exemples du contenu
  const { validationCriteria, examples } = extractValidationAndExamples(content)
  
  return {
    id: articleNumber,
    articleNumber: `Art. ${articleNumber}`,
    type,
    category: { ...category },
    title: title || `Article ${articleNumber}`,
    description: extractDescription(content),
    fullText: content,
    validationCriteria,
    examples,
    testCases: [],
    relatedArticles: extractRelatedArticles(content),
    pageNumber,
    lineNumber: i,
  }
}

/**
 * Parse un article infra-réglementaire
 */
function parseInfraRegulatoryArticle(
  lines: string[],
  startIndex: number,
  irNumber: string,
  title: string,
  category: PCGRuleCategory,
  pageNumber?: number
): PCGRule | null {
  let content = title + '\n'
  let i = startIndex + 1
  
  // Lire jusqu'à la prochaine section/article
  while (i < lines.length) {
    const line = lines[i].trim()
    
    // Arrêter si on rencontre un nouvel article ou une nouvelle section
    if (
      line.match(/^## \*\*Art\./) ||
      line.match(/^#{3,4} (IR\s*\d+|IR\s*\d+-\d+)/i) ||
      line.match(/^#{2,3} .*Section/) ||
      line.match(/^#{2,3} .*Chapitre/) ||
      line.match(/^#{2,3} .*Titre/) ||
      (line.startsWith('##') && i > startIndex + 5)
    ) {
      break
    }
    
    content += line + '\n'
    i++
  }
  
  if (!content.trim() || content.trim() === title) {
    return null
  }
  
  content = content.trim()
  
  // Trouver l'article réglementaire associé (généralement le dernier article mentionné avant)
  const articleMatch = content.match(/article\s+(\d+-\d+)/i) || 
                       content.match(/Art\.\s*(\d+-\d+)/i)
  const relatedArticle = articleMatch ? articleMatch[1] : undefined
  
  const { validationCriteria, examples } = extractValidationAndExamples(content)
  
  return {
    id: `IR${irNumber}-${relatedArticle || 'unknown'}`,
    articleNumber: `IR ${irNumber}`,
    type: 'infra-regulatory',
    category: { ...category },
    title: title,
    description: extractDescription(content),
    fullText: content,
    validationCriteria,
    examples,
    testCases: [],
    relatedArticles: relatedArticle ? [relatedArticle] : [],
    pageNumber,
    lineNumber: i,
  }
}

/**
 * Extrait la description (première phrase ou paragraphe)
 */
function extractDescription(content: string): string {
  // Prendre le premier paragraphe significatif
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 20)
  if (paragraphs.length > 0) {
    const firstPara = paragraphs[0].trim()
    // Limiter à 500 caractères
    return firstPara.length > 500 ? firstPara.substring(0, 500) + '...' : firstPara
  }
  return content.substring(0, 200) + (content.length > 200 ? '...' : '')
}

/**
 * Extrait les critères de validation et exemples du contenu
 */
function extractValidationAndExamples(content: string): {
  validationCriteria: Array<{ id: string; description: string; required: boolean }>
  examples: Array<{ id: string; description: string }>
} {
  const validationCriteria: Array<{ id: string; description: string; required: boolean }> = []
  const examples: Array<{ id: string; description: string }> = []
  
  // Chercher les listes de critères (format: - critère, 1° critère, etc.)
  const criteriaMatches = content.matchAll(/- (.+?)(?:\n|$)/g)
  let criteriaIndex = 1
  for (const match of criteriaMatches) {
    const criterion = match[1].trim()
    if (criterion.length > 10 && criterion.length < 300) {
      validationCriteria.push({
        id: `criteria-${criteriaIndex++}`,
        description: criterion,
        required: !criterion.toLowerCase().includes('peut') && !criterion.toLowerCase().includes('optionnel'),
      })
    }
  }
  
  // Chercher les exemples (sections "Exemple", "Exemples", "IR 4", etc.)
  // Note: Le flag 's' (dotAll) n'est pas disponible avant ES2018, utiliser [\s\S] à la place
  const exampleMatches = content.matchAll(/(?:Exemple|Exemples|IR\s*4)[\s:]*\n([\s\S]+?)(?=\n\n|\n##|\n###|$)/gi)
  let exampleIndex = 1
  for (const match of exampleMatches) {
    const exampleText = match[1].trim()
    if (exampleText.length > 20) {
      examples.push({
        id: `example-${exampleIndex++}`,
        description: exampleText.substring(0, 500),
      })
    }
  }
  
  return { validationCriteria, examples }
}

/**
 * Extrait les références à d'autres articles
 */
function extractRelatedArticles(content: string): string[] {
  const relatedArticles: string[] = []
  const articleMatches = content.matchAll(/article\s+(\d+-\d+)/gi)
  for (const match of articleMatches) {
    const articleId = match[1]
    if (!relatedArticles.includes(articleId)) {
      relatedArticles.push(articleId)
    }
  }
  return relatedArticles
}

/**
 * Sauvegarde le catalogue dans un fichier JSON
 */
export function saveCatalog(catalog: PCGRulesCatalog, outputPath: string): void {
  const fs = require('fs')
  const path = require('path')
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2), 'utf-8')
}

/**
 * Charge le catalogue depuis un fichier JSON
 */
export function loadCatalog(catalogPath: string): PCGRulesCatalog {
  const fs = require('fs')
  const content = fs.readFileSync(catalogPath, 'utf-8')
  return JSON.parse(content) as PCGRulesCatalog
}
