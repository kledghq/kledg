# Espace groupe

Une holding a son **espace groupe** (`/<holding>/group`), ouvert depuis le sélecteur de société (section **Groupes**) ou l'entrée **États, Vue groupe** de la holding. Il remplace le menu de la société par celui du groupe, comme si le groupe était une société :

- le sélecteur affiche le groupe comme sélection courante : la photo de l'associé principal de la holding (à défaut le logo de la holding), « Groupe <holding> » et le nombre de sociétés ;
- le menu ne liste que les pages du groupe, aucune page de société (ni Banque, ni Saisie, ni États) ; choisir une société dans le sélecteur ramène à ses propres pages ;
- le fil d'Ariane lit « Groupe <holding> > page », l'onglet « Page · Groupe <holding> · Kledg » ;
- sur téléphone, le même tiroir que pour une société, refermé après chaque choix ;
- l'exercice de la holding choisi sur une page reste choisi sur les autres.

| Page | Contenu |
| --- | --- |
| Vue d'ensemble | Chiffre d'affaires, EBE, résultat, trésorerie, capitaux propres et endettement du groupe après éliminations ; une carte par société (chiffres clés, déclarations en retard, transactions à rapprocher, brouillons) ; la trésorerie du groupe mois par mois ; la liste des déclarations en retard de toutes les sociétés |
| Sociétés | Forme juridique, SIREN, détention par la holding, dirigeants (de la dernière approbation des comptes, avec la photo de l'associé du même nom), chiffres clés, lien vers la société |
| Comparaison | Les sociétés côte à côte sur l'exercice N et N-1 : chiffre d'affaires, valeur ajoutée, EBE, résultats, CAF, BFR, trésorerie nette, dettes financières, capitaux propres, marges ; l'agrégat du groupe ; un graphique N face à N-1 par société |
| Évolution | Produits, charges, résultat et trésorerie mois par mois, pour le groupe ou une société choisie ; cumul par société |
| Trésorerie | Soldes bancaires par société et par devise, trésorerie comptable (512) mois par mois, comptes courants et prêts entre sociétés et leurs écarts |
| Ratios | Marges, délais de paiement, endettement, BFR et trésorerie nette par société et pour l'agrégat |
| Éliminations | La vue combinée et les flux intragroupe (ci-dessous) |
| Participations | Le tableau des filiales et participations (ci-dessous) |
| Associés et dirigeants | Les personnes et les sociétés qui détiennent des parts, avec leur photo, leurs pourcentages direct, indirect et total dans chaque société, et les dirigeants |
| Impôts et échéances | Le suivi des déclarations de chaque société, résumé par nature (TVA, IS, CFE et CVAE, approbation des comptes, autres), puis la liste |
| Transactions | Les transactions bancaires de toutes les sociétés en une liste, des plus récentes aux plus anciennes, page par page, filtres société, texte, sens et rapprochement ; consultation seule |
| Grand livre combiné | Chaque compte utilisé par les sociétés, le solde de chacune et le total ; les lignes d'un compte dans toutes les sociétés |

La rémunération des dirigeants et la valorisation ne font pas partie de l'espace groupe ; le menu leur garde une place dans la section Structure.

Code : `lib/group` (purs et en centimes : `combine.ts`, `periods.ts`, `aggregate.ts`, `ownership.ts`, `merge-pages.ts`, `deadline-summary.ts` ; `perimeter.ts` et `members.ts` vérifient les accès et lisent chaque société ; un service par page), pages `app/(company)/[companyId]/group/*`, composants `components/features/group`, menu `components/layout/group-nav-config.ts`. API `GET /api/group/{summary, alerts, view, companies, indicators, evolution, treasury, participations, persons, deadlines, transactions, ledger, export}`.

## Éliminations : une vue combinée indicative, pas des comptes consolidés

Kledg additionne les comptes des sociétés lisibles à 100 % et retire les flux intragroupe qu'il trouve. Ce ne sont **pas des comptes consolidés** :

- la consolidation suit le règlement ANC 2020-01 (intégration globale, intégration proportionnelle ou mise en équivalence selon le contrôle, élimination des titres contre les capitaux propres des filiales, intérêts minoritaires, écarts d'acquisition) ; aucune de ces opérations n'est faite ici ;
- l'obligation d'établir des comptes consolidés (Code de commerce, art. L233-16) et ses seuils d'exemption (art. L233-17) ne sont pas évalués ; l'établissement de comptes consolidés est hors du champ de Kledg.

Le pourcentage de détention est affiché, jamais appliqué : une filiale détenue à 60 % compte pour 100 % de ses chiffres. Les titres de participation restent à l'actif combiné (la page le signale avec leur montant), la part des minoritaires n'est pas isolée et les participations indirectes (la filiale d'une filiale) ne sont pas suivies.

## Le groupe

Une seule définition dans Kledg (`lib/management-fees/holding.ts`) : **une société est la holding d'une autre quand elle figure parmi ses actionnaires** (page Informations de la filiale, actionnaire « Société »), quel que soit le pourcentage. C'est la même définition que pour les [frais de gestion](frais-de-gestion.md) ; la section Groupes du sélecteur et l'entrée Vue groupe apparaissent pour les mêmes sociétés.

Les lignes d'actionnaires appartiennent à la filiale : un membre de la holding qui n'est pas membre d'une filiale ne peut pas les lire. La fonction `kledg_group_subsidiary_ids` (migration `20261030090000_group_subsidiaries`, `SECURITY DEFINER`) donne les identifiants des filiales d'une holding, et rien d'autre, uniquement si la holding elle-même est accessible au contexte qui la demande ([rls.md](rls.md)).

## Accès : chaque société est vérifiée

| Action | Holding | Chaque filiale |
| --- | --- | --- |
| Voir les pages de l'espace groupe | `reports:read` | `reports:read` |
| Exporter (CSV, Excel) | `reports:export` | `reports:read` |

- Une filiale dont l'utilisateur n'est pas membre, ou qu'un assistant IA n'a pas reçue dans son autorisation, est **comptée comme non accessible et jamais lue** : ni son nom, ni son identifiant, ni son SIREN, ni ses transactions, associés ou échéances ne sortent du serveur, sur aucune page ni dans aucun export ; ses chiffres ne sont pas additionnés et ses flux ne sont pas éliminés.
- Une filiale dont l'utilisateur est membre avec un rôle qui ne lit pas les états est nommée (il en est membre) et n'est pas lue.
- Chaque filiale lisible est lue dans son propre périmètre d'isolation (`inCompany`, `lib/management-fees/access.ts`) : la base décide encore d'après les adhésions de l'utilisateur et l'autorisation de l'assistant.

## Exercices

Pour l'exercice de la holding, Kledg lit dans chaque filiale l'exercice qui se termine le même jour, sinon celui qui recouvre le plus la période. Une filiale dont l'exercice a d'autres dates est additionnée telle quelle, avec un avertissement ; une filiale sans exercice sur la période n'est pas additionnée et la page le dit.

## Chiffres clés

Les mêmes règles que les [indicateurs financiers](indicateurs-financiers.md), sur les écritures validées de l'exercice, écriture de clôture exclue :

| Chiffre | Définition |
| --- | --- |
| Chiffre d'affaires | Comptes 70, crédit moins débit (2052 FL) |
| Excédent brut d'exploitation | Soldes intermédiaires de gestion (`sig.ts`) |
| Résultat de l'exercice | Produits moins charges |
| Trésorerie | Solde des comptes 512 en fin d'exercice ; le graphique additionne les soldes de fin de mois des sociétés lisibles |
| Capitaux propres | Total DL du bilan, résultat compris |
| Endettement financier | Emprunts et dettes financières (DS, DT, DU hors découverts, DV) |
| Total du bilan | Actif net du bilan au modèle PCG par défaut |

## Flux intragroupe

Kledg cherche, dans les livres de chaque société lisible, ce qui concerne une autre société lisible du groupe :

| Flux | Où | Comment la contrepartie est reconnue |
| --- | --- | --- |
| Frais de gestion | Factures préparées par les [frais de gestion](frais-de-gestion.md) | La facture liée à la facturation ; une facturation dont la facture n'est pas encore comptabilisée et validée est montrée, jamais éliminée |
| Factures entre sociétés du groupe | Factures de vente et d'achat dont l'écriture est validée dans l'exercice | Le SIREN de l'autre partie imprimé sur la facture, sinon celui du tiers |
| Créances et dettes commerciales | 401 à 409, 411 à 419, en fin d'exercice | Le SIREN du tiers du compte auxiliaire, sinon le libellé du compte |
| Comptes courants | 451, 455 | Idem |
| Prêts et avances | 267, 168 | Idem |
| Dividendes | 761 | Le tiers, sinon le libellé du compte, de la ligne ou de l'écriture (« Dividendes Filiale Nord 2025 ») |

Un libellé reconnaît une société quand il contient son nom (accents, ponctuation et forme juridique ignorés, mots entiers, au moins trois lettres) ou son SIREN. Nommez vos sous-comptes d'après la filiale (« 455100 Compte courant Filiale Nord », « 261100 Titres Filiale Nord ») pour qu'ils soient reconnus.

## Règles d’élimination

Seuls les flux dont les deux sociétés sont additionnées sont éliminés, une fois :

- **opérations** (frais de gestion, factures, intérêts) : les produits enregistrés par la société qui facture sortent des produits (du chiffre d'affaires pour les comptes 70, de l'EBE pour les produits d'exploitation), les charges enregistrées par la société facturée sortent des charges. Quand les deux livres concordent, le résultat combiné ne change pas ; sinon la différence apparaît comme un **écart** à justifier (une facture non enregistrée, enregistrée sur un autre exercice ou pour un autre montant) ;
- **dividendes** reçus d'une société du groupe : retirés du résultat combiné, puisque le résultat de la filiale qui les verse y est déjà ;
- **créances et dettes réciproques** en fin d'exercice : le plus petit des deux montants sort de l'actif et du passif combinés (et de l'endettement pour une dette en 16) ; la différence est un écart.

Trésorerie et capitaux propres ne sont pas modifiés par les éliminations.

### Exemple

Une holding H et deux filiales A (80 %) et B (60 %), en euros :

| | H | A | B | Agrégé |
| --- | ---: | ---: | ---: | ---: |
| Chiffre d'affaires | 50 000 | 400 000 | 200 000 | 650 000 |
| EBE | 10 000 | 60 000 | 20 000 | 90 000 |
| Résultat | 25 000 | 40 000 | 8 000 | 73 000 |
| Total du bilan | 320 000 | 260 000 | 90 000 | 670 000 |

Flux trouvés : H facture des frais de gestion à A (30 000, enregistrés 30 000 par A) et à B (20 000, enregistrés 18 000 par B) ; A vend à B pour 10 000 (607 chez B) ; H reçoit 15 000 de dividendes de A ; H a avancé 25 000 à A en compte courant ; B doit 12 000 à A.

| | Éliminations | Après éliminations |
| --- | ---: | ---: |
| Chiffre d'affaires | -60 000 (706 50 000, 707 10 000) | 590 000 |
| EBE | -2 000 (-60 000 de produits, +58 000 de charges) | 88 000 |
| Résultat | -17 000 (-2 000 d'écart, -15 000 de dividendes) | 56 000 |
| Total du bilan | -37 000 (25 000 et 12 000) | 633 000 |

L'écart de 2 000 sur les frais de gestion de B est signalé. Cet exemple est le test `lib/group/__tests__/combine.test.ts`.

## Filiales et participations

Page **Participations**, pour le tableau des filiales et participations des formulaires 2059-G-SD (régime réel normal) et 2033-G-SD (régime simplifié) et de l'annexe :

- **catégorie** : plus de 50 % du capital, filiale (Code de commerce, art. L233-1) ; de 10 à 50 %, participation (art. L233-2) ;
- détention et nombre de titres, tels qu'enregistrés parmi les actionnaires de la filiale ;
- **valeur des titres** dans les livres de la holding : sous-comptes 261 rattachés à la filiale par leur libellé, dépréciation 2961, valeur nette ; les titres qu'aucun libellé ne rattache sont listés à part, jamais devinés ;
- dans les livres de la filiale : capital (101, 104, 108), capitaux propres, chiffre d'affaires et résultat de l'exercice, et la **quote-part des capitaux propres** détenue (arrondie au centime) ;
- prêts et avances consentis par la holding (267, 451, 455 débiteurs) et dividendes encaissés (761).

## Agrégat, ratios et grand livre combiné

Comparaison, Ratios, Évolution et le grand livre combiné additionnent les comptes des sociétés lues à 100 %, compte par compte (`aggregate.ts`), sans retirer les flux intragroupe : c'est une **agrégation**, chaque page le dit. Les indicateurs de l'agrégat suivent les règles des [indicateurs financiers](indicateurs-financiers.md) appliquées à la somme des comptes : un ratio de l'agrégat est celui de la somme, pas la moyenne des sociétés. Les débits et les crédits s'additionnent séparément : un compte bancaire à découvert dans une société reste un découvert.

Exemple : une holding facture 30 000 de frais de gestion à sa filiale A et paie 10 000 de salaires ; A vend pour 200 000 et achète pour 90 000. L'agrégat a 230 000 de chiffre d'affaires (les frais compris) et 100 000 de résultat ; sa marge nette est 100 000 / 230 000 = 43,48 %. C'est le test `lib/group/__tests__/space.test.ts`.

Le grand livre combiné réunit un numéro de compte d'une société à l'autre : les comptes du PCG ont le même sens partout, les sous-comptes sont ceux de chaque société. Les lignes d'un compte sont celles des écritures validées de l'exercice, écriture de clôture exclue, les 1 000 plus récentes.

## Associés et dirigeants

Les associés viennent de la page Informations de chaque société lue (section Actionnaires) ; seuls le nom et la photo sortent, jamais la date de naissance, l'adresse ni les coordonnées. Une même personne enregistrée dans deux sociétés est réunie par son email, sinon par son nom (accents et casse ignorés). Les dirigeants sont ceux de la dernière approbation des comptes de chaque société.

Le **pourcentage indirect** est ce qu'un associé détient par les sociétés du groupe : le produit des pourcentages le long de chaque chaîne de détention, additionné sur les chaînes (`ownership.ts`). Il est indicatif et n'est appliqué à aucun chiffre.

Exemple : Claire détient 60 % de la holding H ; H détient 80 % de A et 40 % de B ; A détient 10 % de B ; Marc détient 40 % de H et 5 % de B en direct.

| | H | A | B |
| --- | ---: | ---: | ---: |
| Claire | 60 % direct | 48 % indirect (60 % x 80 %) | 28,8 % indirect (60 % x (40 % + 80 % x 10 %)) |
| Marc | 40 % direct | 32 % indirect | 5 % direct + 19,2 % indirect = 24,2 % |
| H | | 80 % direct | 40 % direct + 8 % indirect = 48 % |

Une chaîne qui passe par une filiale non lue manque : la page le signale. Une société qui en détient une autre qui la détient (cycle) ne compte qu'une fois par chaîne.

## Impôts et échéances, transactions

Impôts et échéances lit le calendrier et le [suivi des déclarations](echeances.md) de chaque société pour son exercice qui correspond à celui de la holding : le même statut que sur la page Échéances de la société (dépôts de TVA, liasse et acomptes d'IS, approbation, statuts enregistrés). Rien ne s'enregistre depuis l'espace groupe.

Transactions fusionne les transactions des sociétés page par page (`merge-pages.ts`) : chaque société donne ses lignes après le curseur dans le même ordre (date puis identifiant, des plus récentes aux plus anciennes), la page garde les premières, et le curseur suivant est la dernière gardée ; aucune ligne n'est perdue ni répétée. Un filtre sur une société qui n'est pas lue répond « Société introuvable dans ce groupe. », qu'elle existe ou non.

## Exports et outils MCP

Chaque page a **Exporter en CSV** et **Exporter en Excel** (`GET /api/group/export?report=`) : `combined`, `participations`, `companies`, `indicators`, `evolution`, `treasury`, `persons`, `deadlines`, `transactions` (les 5 000 plus récentes, avec les filtres de la page), `ledger`. Droit `reports:export` dans la holding, `reports:read` dans chaque filiale lue ; cellules protégées contre les formules (`lib/reports/csv-safe.ts`).

| Outil | Rôle |
| --- | --- |
| `get_group_view` | Vue combinée : chiffres par société, agrégés et après éliminations, flux et écarts, trésorerie par mois |
| `get_participations` | Tableau des filiales et participations |
| `get_group_companies` | Sociétés, détention, dirigeants, chiffres clés |
| `get_group_indicators` | Indicateurs N et N-1 par société et de l'agrégat |
| `get_group_evolution` | Produits, charges, résultat et trésorerie par mois |
| `get_group_treasury` | Comptes bancaires, trésorerie par mois, comptes courants entre sociétés |
| `get_group_shareholders` | Associés, pourcentages direct, indirect et total, dirigeants (sans photo) |
| `get_group_deadlines` | Échéances et statuts du suivi de chaque société |
| `get_group_alerts` | Déclarations en retard, transactions à rapprocher, brouillons |
| `list_group_transactions` | Transactions du groupe page par page |
| `get_group_ledger` | Grand livre combiné et lignes d'un compte |

Tous en lecture seule, avec `reports:read` dans la holding et dans chaque filiale lue. Un assistant n'atteint que les filiales de son autorisation : les autres sont comptées, ni lues ni nommées ([serveur MCP](mcp.md)).

## Ce que l'ancienne application faisait autrement

L'ancienne application multipliait les soldes de chaque société par le pourcentage de détention et appelait le résultat « consolidation » ; son bilan « consolidé » additionnait les totaux mais renvoyait les lignes de la première société, et ignorait sans le dire une société aux dates d'exercice différentes. Ses éliminations étaient seulement détectées et affichées, jamais appliquées. Trois définitions de la holding s'y contredisaient (une case à cocher, un type de société, les actionnaires), et le périmètre comprenait toute société détenue à plus de 1 %, lue sans être membre. Sa page Entreprises du groupe listait toutes les sociétés de la base ; la liste des personnes du groupe et les statistiques du groupe ne vérifiaient pas l'accès à la holding ; la page des impôts du groupe parcourait toutes les sociétés de la base et écrivait des déclarations lors d'une simple lecture. Kledg garde une définition, vérifie chaque société, n'écrit rien depuis l'espace groupe et appelle chaque chiffre ce qu'il est : combiné, agrégé, indicatif.
