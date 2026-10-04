# Vue groupe : vue combinée, flux intragroupe et participations

La page **États, Vue groupe** (`/<société>/group`) n'apparaît que dans une holding. Pour un exercice de la holding, elle présente :

- les chiffres clés de la holding et de chacune de ses filiales lisibles, côte à côte et additionnés ;
- les flux entre les sociétés du groupe trouvés dans les livres, et les chiffres combinés **après éliminations** ;
- la trésorerie du groupe mois par mois ;
- le tableau des **filiales et participations** de la holding.

Code : `lib/group` (`combine.ts` et `periods.ts` purs, en centimes ; `read-member.ts` lit une société ; `perimeter.ts` vérifie les accès ; un service par écran), API `GET /api/group/view`, `GET /api/group/participations`, `GET /api/group/export`, outils MCP `get_group_view` et `get_participations`.

## Une vue combinée indicative, pas des comptes consolidés

Kledg additionne les comptes des sociétés lisibles à 100 % et retire les flux intragroupe qu'il trouve. Ce ne sont **pas des comptes consolidés** :

- la consolidation suit le règlement ANC 2020-01 (intégration globale, intégration proportionnelle ou mise en équivalence selon le contrôle, élimination des titres contre les capitaux propres des filiales, intérêts minoritaires, écarts d'acquisition) ; aucune de ces opérations n'est faite ici ;
- l'obligation d'établir des comptes consolidés (Code de commerce, art. L233-16) et ses seuils d'exemption (art. L233-17) ne sont pas évalués ; l'établissement de comptes consolidés est hors du champ de Kledg.

Le pourcentage de détention est affiché, jamais appliqué : une filiale détenue à 60 % compte pour 100 % de ses chiffres. Les titres de participation restent à l'actif combiné (la page le signale avec leur montant), la part des minoritaires n'est pas isolée et les participations indirectes (la filiale d'une filiale) ne sont pas suivies.

## Le groupe

Une seule définition dans Kledg (`lib/management-fees/holding.ts`) : **une société est la holding d'une autre quand elle figure parmi ses actionnaires** (page Informations de la filiale, actionnaire « Société »), quel que soit le pourcentage. C'est la même définition que pour les [frais de gestion](frais-de-gestion.md), et l'entrée Vue groupe apparaît dans les mêmes sociétés.

Les lignes d'actionnaires appartiennent à la filiale : un membre de la holding qui n'est pas membre d'une filiale ne peut pas les lire. La fonction `kledg_group_subsidiary_ids` (migration `20261030090000_group_subsidiaries`, `SECURITY DEFINER`) donne les identifiants des filiales d'une holding, et rien d'autre, uniquement si la holding elle-même est accessible au contexte qui la demande ([rls.md](rls.md)).

## Accès : chaque société est vérifiée

| Action | Holding | Chaque filiale |
| --- | --- | --- |
| Voir la vue groupe et les participations | `reports:read` | `reports:read` |
| Exporter (CSV, Excel) | `reports:export` | `reports:read` |

- Une filiale dont l'utilisateur n'est pas membre, ou qu'un assistant IA n'a pas reçue dans son autorisation, est **comptée comme non accessible et jamais lue** : ni son nom, ni son identifiant, ni son SIREN ne sortent du serveur, ses chiffres ne sont pas additionnés et ses flux ne sont pas éliminés.
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

## Éliminations

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

Onglet **Participations**, pour le tableau des filiales et participations des formulaires 2059-G-SD (régime réel normal) et 2033-G-SD (régime simplifié) et de l'annexe :

- **catégorie** : plus de 50 % du capital, filiale (Code de commerce, art. L233-1) ; de 10 à 50 %, participation (art. L233-2) ;
- détention et nombre de titres, tels qu'enregistrés parmi les actionnaires de la filiale ;
- **valeur des titres** dans les livres de la holding : sous-comptes 261 rattachés à la filiale par leur libellé, dépréciation 2961, valeur nette ; les titres qu'aucun libellé ne rattache sont listés à part, jamais devinés ;
- dans les livres de la filiale : capital (101, 104, 108), capitaux propres, chiffre d'affaires et résultat de l'exercice, et la **quote-part des capitaux propres** détenue (arrondie au centime) ;
- prêts et avances consentis par la holding (267, 451, 455 débiteurs) et dividendes encaissés (761).

## Exports et outils MCP

**Exporter en CSV** et **Exporter en Excel** exportent l'onglet affiché : la vue combinée (chiffres par société, éliminations, sociétés, flux, trésorerie) ou les participations, avec la mention de vue indicative. Cellules protégées contre les formules (`lib/reports/csv-safe.ts`).

| Outil | Rôle |
| --- | --- |
| `get_group_view` | Chiffres par société, agrégés et après éliminations, flux et écarts, trésorerie par mois ; `reports:read` dans la holding et dans chaque filiale lue |
| `get_participations` | Tableau des filiales et participations ; mêmes droits |

Un assistant n'atteint que les filiales de son autorisation : les autres sont comptées, ni lues ni nommées ([serveur MCP](mcp.md)).

## Ce que l'ancienne application faisait autrement

L'ancienne application multipliait les soldes de chaque société par le pourcentage de détention et appelait le résultat « consolidation » ; son bilan « consolidé » additionnait les totaux mais renvoyait les lignes de la première société, et ignorait sans le dire une société aux dates d'exercice différentes. Ses éliminations étaient seulement détectées et affichées, jamais appliquées. Trois définitions de la holding s'y contredisaient (une case à cocher, un type de société, les actionnaires), et le périmètre comprenait toute société détenue à plus de 1 %, lue sans être membre. Kledg garde une définition, vérifie chaque société et appelle sa vue ce qu'elle est : combinée et indicative.
