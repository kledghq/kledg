# Budget

Les charges et les produits prévus pour un exercice, mois par mois, comparés aux écritures validées de cet exercice. Code : `lib/budgets`, page `/budget` (États, Budget), outil MCP `get_budget_report`.

## Un budget par exercice

API `GET|POST /api/budgets`, `GET|DELETE /api/budgets/[id]`.

- Chaque exercice a au plus un budget. Il se crée vide ou avec une ligne par grand poste : 60 Achats, 61 Services extérieurs, 62 Autres services extérieurs, 63 Impôts et taxes, 64 Charges de personnel, 65 Autres charges de gestion courante et 70 Ventes.
- Le budget d'un exercice clôturé ne se modifie plus et ne se supprime plus : il reste ce à quoi l'exercice a été comparé.
- Un administrateur ou le comptable de la société établit le budget (droit `budgets:manage`) ; un membre en lecture seule le consulte avec sa comparaison (droit `reports:read`).
- La base garde le budget dans la société de son exercice (clé étrangère sur l'exercice et la société) et le protège par la sécurité au niveau des lignes ([rls.md](rls.md)).

## Lignes

API `POST /api/budgets/[id]/lines`, `PATCH|DELETE /api/budget-lines/[id]`.

- **Une ligne** porte sur un compte ou un début de compte de la classe 6 (charges) ou 7 (produits), les deux classes du compte de résultat (PCG art. 821-1). Le premier chiffre est la classe, chaque chiffre suivant la subdivise (PCG art. 932-1) : `62` couvre tous les comptes 62, `6226` les seuls honoraires, `622600` un seul compte.
- Un début de compte plutôt qu'un compte : les comptes de Kledg appartiennent à un exercice, un début de compte reste valable d'un exercice à l'autre.
- **Lignes qui se recouvrent** : un compte va à la ligne dont le début est le plus long. Avec `62` et `6226`, les honoraires vont à `6226` et le reste des comptes 62 à `62`. Aucun montant n'est compté deux fois.
- Le libellé est facultatif : vide, c'est celui du compte dans le plan de la société, sinon celui du compte PCG le plus proche.
- **Montants par mois**, en centimes, pour chaque mois civil que l'exercice touche : 12 mois pour un exercice civil, jusqu'à 24 pour un premier exercice long, le premier et le dernier mois partiels compris. Un montant annuel peut être réparti également, l'arrondi sur le dernier mois, si bien que les mois font exactement le total.
- **Éléments récurrents** : un abonnement, un loyer, une prime d'assurance. Un montant, une fréquence (mensuel, trimestriel, annuel), un premier mois et un dernier mois facultatif. Le premier mois fixe le rythme, même s'il précède l'exercice : une prime trimestrielle commencée en novembre 2025 tombe en février, mai, août et novembre 2026. Ses montants s'ajoutent à ceux saisis par mois. Un élément qui ne tombe dans aucun mois de l'exercice est refusé.
- Les montants peuvent être négatifs (un rabais attendu au 609, par exemple).

## Budget et réalisé

API `GET /api/budgets/[id]/report?throughMonth=AAAA-MM`.

- **Réalisé** : les soldes des comptes de classe 6 et 7 sur les écritures validées de l'exercice, sans l'écriture de clôture, exactement comme le compte de résultat. Charges au débit moins le crédit, produits au crédit moins le débit. Les brouillons ne comptent pas. Chaque écriture compte dans le mois de sa date.
- Les totaux viennent de l'agrégat du grand livre commun à tous les états (`lib/reports/ledger/aggregate.ts`, découpé par mois), jamais d'une requête à part.
- **Hors budget** : les comptes de classe 6 ou 7 mouvementés qu'aucune ligne ne couvre, chacun avec un budget nul. Les totaux des charges et des produits sont donc ceux du compte de résultat, et le résultat est les produits moins les charges.
- **Écart** : réel moins budget, en euros et en pourcentage du budget (pas de pourcentage sans budget). Il est favorable quand une charge reste sous son budget ou qu'un produit, comme le résultat, le dépasse.
- **Jusqu'à un mois** : en cours d'année, la comparaison porte sur les mois jusqu'à la fin du mois choisi, avec le budget des mêmes mois ; le budget de l'exercice entier reste affiché.
- La page montre aussi chaque mois, pour le résultat, les totaux ou une ligne.

## Hors du budget

- Pas d'alerte planifiée : la comparaison et ses écarts se consultent sur la page ou par l'outil MCP.
- Pas de prévision de trésorerie : la trésorerie passée est au tableau de bord, une prévision demanderait les échéances des factures.

## MCP

`get_budget_report` (droit `reports:read`) : le budget d'un exercice (l'exercice en cours par défaut) et sa comparaison par ligne, avec les comptes hors budget et les totaux, en euros ; `throughMonth` pour l'année jusqu'à un mois, `monthly` pour le détail de chaque mois. Voir [mcp.md](mcp.md).
