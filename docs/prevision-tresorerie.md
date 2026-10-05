# Prévision de trésorerie

Le solde bancaire projeté sur les 3, 6 ou 12 prochains mois, par mois ou par semaine, à partir du solde du jour et des flux que Kledg connaît déjà, avec un seuil d'alerte par société. Code : `lib/cash-forecast`, page `/prevision-tresorerie` (Banque, Prévision de trésorerie), outil MCP `get_cash_forecast`. C'est une projection, pas une garantie : la page, l'export, les alertes et l'outil MCP le disent.

Aucune règle financière n'est réécrite : chaque flux vient d'un service qu'un écran expert utilise déjà, si bien que la prévision et ces écrans s'accordent au centime.

## Solde de départ

- **Banques** : la somme des soldes déclarés par les banques pour les comptes en euros (comptes remplacés par une connexion directe exclus), comme la source `bank-accounts` du tableau de bord. Les comptes dans une autre devise sont comptés à part et laissés de côté.
- **Comptabilité**, sans compte bancaire en euros : le solde des comptes 512 à la fin du mois en cours de l'exercice qui contient aujourd'hui (`lib/dashboard/ledger-cash.ts`, écritures validées, à-nouveaux compris).
- Sinon zéro, et la page le dit.

La projection commence demain : le solde du jour contient déjà les opérations du jour. Elle se termine le même jour du mois, 3, 6 ou 12 mois plus tard (le dernier jour d'un mois plus court).

## Composantes

Chaque flux appartient à une composante que la page permet de cocher ou décocher ; la courbe, les périodes, le point bas et l'alerte sont recalculés aussitôt dans le navigateur, avec la même fonction pure que le serveur (`lib/cash-forecast/projection.ts`).

| Composante | Source | Par défaut |
| --- | --- | --- |
| Factures clients à encaisser | Lignes ouvertes (non lettrées) des comptes 411 de l'exercice en cours, comme la balance âgée (`loadThirdPartyLines`). Échéance : délai de paiement du tiers, sinon celui de la société (Code de commerce, art. L441-10, `lib/reports/third-parties/payment-terms.ts`). Par tiers, les règlements, avoirs et acomptes non lettrés s'imputent sur les factures les plus anciennes ; un tiers créditeur ne donne aucun flux. | Oui |
| Factures fournisseurs à payer | Mêmes règles sur les comptes 401, en sortie. | Oui |
| Impôts et taxes | Échéances du calendrier (`lib/deadlines`) qui demandent un paiement et ne sont pas réglées (`lib/declarations`), avec leur montant quand il est connu : montant enregistré dans le suivi ou tenu par un autre module, sinon la prochaine déclaration de TVA quand ses contrôles passent (`vatReturnForDeadline`), le solde d'IS et les acomptes de l'exercice suivant de la feuille d'impôt sur les sociétés (`buildCorporateTax`), la CFE d'après l'avis saisi (`cfeSchedule`). Un crédit (TVA, excédent d'IS) n'est pas compté. Une échéance sans montant connu est listée à part, sans être comptée. | Oui |
| Paiements récurrents | Séries détectées dans les opérations bancaires ([abonnements](abonnements.md)), abonnements et charges récurrentes (salaires, cotisations, emprunts), au montant actuel et à leur rythme à partir de la prochaine date attendue. Exclus : les séries ignorées, peut-être arrêtées, et les impôts (comptés avec les échéances). | Oui |
| Budget (hypothèse) | Lignes des budgets des exercices couverts ([budget](budget.md)), mois par mois à partir du mois prochain, réparties sur les jours du mois. Les produits entrent, les charges sortent. Exclues : dotations et reprises (68, 78), variations de stocks (603, 713), cessions (675, 775). Montants hors taxes. | Non |
| Rythme récent (hypothèse) | Variation moyenne du solde bancaire (crédits moins débits des comptes en euros) sur les trois derniers mois complets couverts par des opérations, répétée chaque mois à partir du mois prochain, répartie sur ses jours. | Non |

Le budget et le rythme récent recoupent les flux connus et se recoupent entre eux : le rythme récent contient déjà les paiements récurrents et ce que le budget prévoit. La page avertit quand le rythme récent est coché avec l'un des deux.

## Règles de calcul

Montants en centimes entiers, jours en `yyyy-mm-dd` (jamais d'heure locale).

- Un flux daté avant demain et toujours ouvert (une facture échue) est compté le premier jour et signalé en retard ; un flux après le dernier jour est ignoré.
- Un flux réparti (un mois de budget, le rythme récent) est divisé en parts égales sur les jours de sa période, le reste sur les derniers jours, de sorte que les parts font exactement le montant ; seuls les jours dans la fenêtre comptent.
- Le solde est suivi jour par jour : le point bas d'une période peut être au milieu (une TVA payée le 19, un client qui paie le 30), même si la période se termine au-dessus du seuil.
- Périodes : mois civils ou semaines du lundi au dimanche, la première et la dernière coupées par la fenêtre.
- Seuil : le premier jour où le solde est strictement sous le seuil. Si le solde du jour l'est déjà, l'alerte le dit.

## Seuil d'alerte

Colonne `cashForecastSettings` de `companies` (JSON, migration `20261114090000_cash_forecast`, couverte par les politiques de sécurité au niveau des lignes de la table), lue par `parseCashForecastSettings` : un champ illisible reprend sa valeur par défaut.

| Champ | Valeur | Par défaut |
| --- | --- | --- |
| `thresholdCents` | Solde minimum en centimes, zéro ou négatif (découvert autorisé) accepté ; `null` : pas d'alerte | `null` |
| `horizonMonths` | 3, 6 ou 12 | 6 |
| `components` | Composantes comptées par l'alerte et proposées cochées sur la page | les quatre flux connus |

Le formulaire de la page enregistre le seuil avec l'horizon et les composantes affichés. L'alerte (`alertOf`, `lib/cash-forecast/alert.ts`) apparaît :

- sur le **tableau de bord**, au-dessus des widgets quelle que soit la disposition, avec un lien vers la page (`GET /api/cash-forecast/alert`, qui ne calcule rien sans seuil) ;
- sur l'**accueil du mode simple**, avec des mots simples (`cashAlert` de `loadSimpleHome`) ;
- sur la page elle-même, qui surligne les périodes sous le seuil.

L'alerte est calculée à la lecture : il n'y a ni tâche planifiée ni table d'alertes.

## Mode simple

Même page, avec le vocabulaire de [mode simple](mode-simple.md) : « Votre argent dans les prochains mois », « Ce que vos clients vont vous payer », « Abonnements, salaires et prélèvements », les impôts par leur titre simple (`declarationTitle`), sans numéro de compte ni terme comptable (`SIMPLE_MODE_JARGON`, vérifié par les tests). Les phrases sont dans `lib/cash-forecast/wording.ts` et `components.ts`. La page n'est pas dans la navigation du mode simple (les sept entrées de la maquette) : l'accueil y mène par la carte d'alerte.

## API et droits

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/cash-forecast?companyId=&horizon=3\|6\|12&granularity=month\|week&components=` | `reports:read` et `banking:read` | Solde de départ, tous les flux de toutes les composantes, échéances sans montant, projection des composantes demandées (celles du réglage par défaut) |
| `GET /api/cash-forecast/alert?companyId=` | `reports:read` et `banking:read` | `{ alert }`, `null` sans seuil ou au-dessus |
| `GET /api/cash-forecast/export?...` | `reports:export` et `banking:read`, limite `export` | CSV : périodes, puis chaque flux compté, puis les échéances sans montant |
| `GET /api/companies/[id]/cash-forecast-settings` | `settings:read` | Réglages |
| `PUT /api/companies/[id]/cash-forecast-settings` | `settings:update` | Remplace les réglages, journal d'audit `UPDATE_CASH_FORECAST_SETTINGS` |

MCP : `get_cash_forecast` (lecture), le seuil par `get_company_settings` et `update_company_settings`, section `cash_forecast` (contrôle total).

## Limites

- Le budget est hors taxes ; les factures ouvertes et les échéances sont des montants TTC ou de taxe.
- Une facture payée à la banque mais pas encore lettrée reste ouverte : rapprocher et lettrer garde la prévision juste.
- Les acomptes d'IS ne sont connus que pour l'exercice qui suit la feuille due ; les autres échéances sans montant sont listées.
- Une échéance fiscale déjà passée et non marquée comme payée n'est pas comptée : la prévision part des échéances à venir.
- Les revenus récurrents des clients ne sont pas détectés : le budget ou le rythme récent les représentent.
- Pas de vue groupe : la prévision est celle d'une société.

## Tests

- `lib/cash-forecast/__tests__/projection.test.ts`, `flows.test.ts`, `settings-and-wording.test.ts` : fenêtre, périodes, répartition au centime, point bas, seuil, flux de chaque composante, réglages, phrases sans jargon.
- `lib/cash-forecast/__tests__/cash-forecast.db.test.ts` : service sur une base réelle (solde des banques, factures ouvertes, CFE, feuille d'IS, paiement récurrent, budget, rythme récent), routes, droits, isolation des sociétés, export, alerte du tableau de bord et de l'accueil simple.
- `components/features/cash-forecast/__tests__/cash-forecast-page.test.tsx` : page, recalcul en décochant, enregistrement du seuil, mode simple, lecture seule, cartes d'alerte.
- `lib/mcp/__tests__/cash-forecast-tools.test.ts`, `lib/api/__tests__/authorization-matrix.test.ts`.
