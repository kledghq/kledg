# Tableau de bord

Le tableau de bord d'une société (`app/(company)/[companyId]/page.tsx`) est
fait de widgets que chaque utilisateur choisit, range et dimensionne pour
lui-même, société par société.

## Widgets

Le registre est `lib/dashboard/widgets.ts` (pur, partagé par l'interface,
l'API et les tests) : identifiant, titre, description, tailles proposées,
taille par défaut, source de données. Chaque source est chargée par une
requête (`GET /api/dashboard/widgets?companyId=&source=&fiscalYearId=`,
`lib/dashboard/load-widget-data.service.ts`) ; les widgets d'une même
source partagent cette requête. Les montants sont en centimes.

| Widget | Source | Données |
|---|---|---|
| Démarrer | `onboarding` | Guide de démarrage (`lib/onboarding`) ; disparaît une fois terminé ou masqué |
| Chiffre d'affaires, Produits, Charges, Résultat | `ledger` | Soldes des comptes 70, 7 et 6 de l'exercice, hors écritures de clôture : les mêmes totaux que le compte de résultat (`loadStatementAccounts`) ; comparaison avec l'exercice précédent sur la même durée |
| Trésorerie | `ledger` | Solde des comptes 512, et soldes déclarés par les banques (comptes remplacés par une connexion directe exclus) |
| TVA | `ledger` | Estimation d'après les comptes 445 (crédit moins débit : à payer, ou crédit) |
| Marge commerciale | `ledger` | 707 et 7097 moins 607, 6087, 6097 et 6037 (formulaire 2052, lignes FC, FS, FT) ; sans objet sans marchandises |
| Excédent brut d'exploitation, Capacité d'autofinancement, Besoin en fonds de roulement, Délais de paiement | `indicators` | Les chiffres de la page SIG et ratios (`lib/reports/financial-indicators`, [indicateurs financiers](indicateurs-financiers.md)) : EBE et résultat d'exploitation, CAF et résultat de l'exercice, BFR et trésorerie nette, délais clients et fournisseurs en jours, TVA comprise ; lien vers la page |
| Créances clients, Dettes fournisseurs | `ledger` | Soldes des comptes 411 et 401 |
| Répartition des charges | `ledger` | Postes 60 à 65, puis le reste de la classe 6 |
| Produits et charges par mois | `monthly` | Agrégat SQL par mois (`lib/reports/dashboard.ts`) |
| Trésorerie dans le temps | `treasury` | Solde 512 en fin de mois, à-nouveaux compris (`lib/dashboard/ledger-cash.ts`) |
| À rapprocher, Opérations à rapprocher | `reconciliation` | Transactions bancaires sans écriture (même compte que l'indicateur de l'en-tête) et les cinq plus récentes |
| Brouillons à valider | `drafts` | Écritures en brouillon de l'exercice |
| Dernières écritures | `recent-entries` | Les cinq écritures les plus récentes de l'exercice |
| Comptes bancaires | `bank-accounts` | Solde, dernière synchronisation, accès à renouveler (jamais d'identifiants) |
| Règles d'affectation les plus utilisées | `rules` | Les cinq règles au plus grand `usageCount` |
| Créances et dettes échues | `aged-balance` | Balance âgée de l'exercice au jour de référence (`lib/reports/third-parties`) : montant échu et montant en cours des clients et des fournisseurs, les cinq tiers les plus en retard ([lettrage et tiers](lettrage-et-tiers.md)) |
| Échéances | `deadlines` | Échéances fiscales et juridiques des 60 prochains jours et celles manquées depuis 15 jours (`lib/deadlines`), indépendantes de l'exercice choisi ; lien vers la page Échéances |

Chaque source exige une permission (`SOURCE_PERMISSIONS`) : un rôle ne voit
ni ne peut ajouter un widget dont il ne peut pas lire les données. Le guide
Démarrer est réservé à ceux qui tiennent la comptabilité (`ledger:manage`).

Le widget Échéances lit le calendrier de `lib/deadlines/engine.ts` (pur,
testé règle par règle avec ses sources) à partir des régimes de la société,
de leur historique, de ses exercices et des paramètres de la carte
Échéances de la page Informations (`Company.deadlineSettings`). Les dates
sont indicatives : un jour que Kledg ne connaît pas (celui de la CA3) prend
la valeur la plus tôt possible pour la forme juridique et le dit. La page
complète est `app/(company)/[companyId]/echeances` (`GET /api/deadlines`). Chaque
échéance porte son statut (déposée, payée, en retard, non due) d'après le
suivi des déclarations ([échéances](echeances.md)).

## Alerte de trésorerie

Une carte d'état de la [prévision de trésorerie](prevision-tresorerie.md) se place au-dessus des widgets, quelle que soit la disposition, avec un lien vers la prévision : l'alerte (jour et solde prévu) quand la projection passe sous le seuil de la société dans son horizon, sinon une ligne qui dit que le solde reste au-dessus, ou sans seuil une invitation à en définir un. Elle est demandée une fois la page affichée (`GET /api/cash-forecast/alert`, droits `reports:read` et `banking:read`), avec un squelette de même hauteur en attendant : la prévision ne retarde pas le tableau de bord et rien ne bouge à son arrivée. Rien ne s'affiche pour un membre qui ne peut pas lire la banque.

## Dispositions par défaut

| Profil | Rôles | Contenu |
|---|---|---|
| Dirigeant | administrateur de l'instance, administrateur de la société | Démarrer, chiffre d'affaires, résultat, trésorerie, à rapprocher, produits et charges par mois, trésorerie dans le temps, opérations à rapprocher, échéances, brouillons, créances et dettes échues, comptes bancaires |
| Comptable | comptable | Démarrer, brouillons, opérations à rapprocher, TVA, échéances, résultat, chiffre d'affaires, à rapprocher, créances et dettes échues, produits et charges, dernières écritures, répartition des charges, règles |
| Lecture seule | lecture seule | Indicateurs et graphiques seulement |

## Personnalisation

« Personnaliser » ouvre le mode édition : glisser un widget par sa poignée
(souris, tactile, ou clavier : Espace puis les flèches), ou les boutons
Monter et Descendre ; choisir une taille (S une colonne, M deux, L toute la
ligne ; la grille passe de une à deux puis quatre colonnes selon la place) ;
retirer un widget ; « Ajouter un widget » liste ceux qui sont masqués.
« Enregistrer » sauvegarde, « Rétablir la disposition par défaut » revient
à celle du rôle. Chaque changement est annoncé aux lecteurs d'écran.

La disposition est enregistrée par utilisateur et par société (table
`dashboard_layouts`, `GET`, `PUT` et `DELETE /api/dashboard/layout`). Elle
est toujours celle de l'utilisateur connecté : aucune requête ne lit ni
n'écrit celle d'un autre. Le JSON est validé par zod à la lecture et à
l'écriture (`lib/dashboard/layout.ts`) ; les identifiants inconnus sont
ignorés, si bien qu'un widget ajouté ou retiré plus tard ne casse aucune
disposition enregistrée. Un nouveau widget apparaît dans le catalogue des
utilisateurs qui ont déjà personnalisé leur tableau de bord, et dans la
disposition par défaut de ceux qui ne l'ont pas fait.

## Ajouter un widget

1. Sa définition dans `WIDGETS` (`lib/dashboard/widgets.ts`), avec une source
   existante ou une nouvelle (loader dans `load-widget-data.service.ts`,
   permission dans `SOURCE_PERMISSIONS`).
2. Son rendu dans `components/features/dashboard/widgets` et dans
   `WIDGET_COMPONENTS` (le typage oblige à garder les deux listes alignées).
3. Si besoin, sa place dans `DEFAULT_LAYOUTS`.
4. Un test de ses données (`lib/dashboard/__tests__/dashboard.db.test.ts`, ou
   le dossier de tests du module qui la fournit, comme
   `lib/deadlines/__tests__/deadlines-routes.db.test.ts`).
