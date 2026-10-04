// Utilitaires pour la génération PDF

/**
 * Formate un montant pour l'affichage PDF (format français)
 * Force l'utilisation d'un espace comme séparateur de milliers
 * pour éviter les problèmes avec @react-pdf/renderer qui peut utiliser un backslash
 */
export function formatAmount(amount: number): string {
  if (amount === 0) return '0,00'
  
  const absAmount = Math.abs(amount)
  // Formatage avec séparateurs de milliers (espaces en français) et virgule comme séparateur décimal
  const parts = absAmount.toFixed(2).split('.')
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const formatted = `${integerPart},${parts[1]}`
  
  return amount < 0 ? `(${formatted})` : formatted
}
