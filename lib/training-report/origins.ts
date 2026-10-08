/**
 * Lines of frame C of the bilan pédagogique et financier, "Bilan financier
 * hors taxes : origine des produits de l'organisme" (cerfa 10443*17, notice
 * 50199#17). Labels as printed on the form. Pure data, usable on both
 * sides.
 *
 * Lines a to h are the products from the organisations managing the funds
 * of vocational training (OPCO, CPIR, Caisse des dépôts, FAF); line 2 is
 * their total. The total of frame C adds lines 1 to 11 (line 2 standing for
 * a to h). "none" is revenue outside vocational training: it stays out of
 * frame C and counts only in the global turnover.
 */

export const TRAINING_ORIGINS = [
  { code: 'c1', line: '1', label: 'Produits provenant des entreprises pour la formation de leurs salariés' },
  { code: 'c2a', line: 'a', label: 'Organismes gestionnaires des fonds de la formation : contrats d’apprentissage' },
  { code: 'c2b', line: 'b', label: 'Organismes gestionnaires des fonds de la formation : contrats de professionnalisation' },
  { code: 'c2c', line: 'c', label: 'Organismes gestionnaires des fonds de la formation : promotion ou reconversion par alternance' },
  { code: 'c2d', line: 'd', label: 'Organismes gestionnaires des fonds de la formation : projets de transition professionnelle' },
  { code: 'c2e', line: 'e', label: 'Organismes gestionnaires des fonds de la formation : compte personnel de formation' },
  { code: 'c2f', line: 'f', label: 'Organismes gestionnaires des fonds de la formation : dispositifs spécifiques pour les personnes en recherche d’emploi' },
  { code: 'c2g', line: 'g', label: 'Organismes gestionnaires des fonds de la formation : dispositifs spécifiques pour les travailleurs non-salariés' },
  { code: 'c2h', line: 'h', label: 'Organismes gestionnaires des fonds de la formation : plan de développement des compétences ou autres dispositifs' },
  { code: 'c3', line: '3', label: 'Pouvoirs publics pour la formation de leurs agents (État, collectivités territoriales, établissements publics à caractère administratif)' },
  { code: 'c4', line: '4', label: 'Pouvoirs publics pour la formation de publics spécifiques : instances européennes' },
  { code: 'c5', line: '5', label: 'Pouvoirs publics pour la formation de publics spécifiques : État' },
  { code: 'c6', line: '6', label: 'Pouvoirs publics pour la formation de publics spécifiques : conseils régionaux' },
  { code: 'c7', line: '7', label: 'Pouvoirs publics pour la formation de publics spécifiques : France Travail (ex Pôle emploi)' },
  { code: 'c8', line: '8', label: 'Pouvoirs publics pour la formation de publics spécifiques : autres ressources publiques' },
  { code: 'c9', line: '9', label: 'Contrats conclus avec des personnes à titre individuel et à leurs frais' },
  { code: 'c10', line: '10', label: 'Contrats conclus avec d’autres organismes de formation (y compris CFA)' },
  { code: 'c11', line: '11', label: 'Autres produits au titre de la formation professionnelle' },
  { code: 'none', line: '', label: 'Hors formation professionnelle (pas dans le cadre C)' },
] as const

export type TrainingOrigin = (typeof TRAINING_ORIGINS)[number]['code']
export const TRAINING_ORIGIN_CODES = TRAINING_ORIGINS.map((o) => o.code) as [TrainingOrigin, ...TrainingOrigin[]]
export const OPCO_ORIGINS: readonly TrainingOrigin[] = ['c2a', 'c2b', 'c2c', 'c2d', 'c2e', 'c2f', 'c2g', 'c2h']

export function isTrainingOrigin(value: string | null | undefined): value is TrainingOrigin {
  return value !== null && value !== undefined && (TRAINING_ORIGIN_CODES as readonly string[]).includes(value)
}

