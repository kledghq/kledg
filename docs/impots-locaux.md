# Impôts locaux (CFE, CVAE)

Le guide d'utilisation (à quoi sert la fonctionnalité, étapes, règles
expliquées) est sur le site : [Les impôts locaux : CFE et CVAE](https://www.kledg.com/fr/docs/les-impots-locaux).
Cette page décrit le fonctionnement technique : code, API, règles de calcul,
droits et limites d'implémentation.

Kledg prépare les deux impôts de la contribution économique territoriale
(CET) d'une année civile : la CFE d'après l'avis d'imposition saisi, la CVAE
calculée sur la valeur ajoutée des comptes. Kledg ne dépose rien, ne paie
rien et ne transmet rien à l'administration.

Page : États, Impôts locaux (CFE, CVAE) (`/<société>/impots-locaux?annee=2026`,
mode expert). Code : `lib/local-taxes`. Les échéances des deux impôts et leur
suivi (déposée, payée, en retard) sont ceux du calendrier
([échéances](echeances.md)). Règles : la loi en vigueur au 5 octobre 2026.

## CFE

La CFE est due chaque année par qui exerce une activité professionnelle non
salariée au 1er janvier (CGI, art. 1447). Sa base est la valeur locative des
biens passibles de taxe foncière utilisés pour l'activité (CGI, art. 1467),
son taux celui que vote la commune : **Kledg ne peut pas la calculer**. L'utilisateur
saisit l'avis d'imposition (montant total, acompte demandé, date, note),
une ligne par année (table `local_taxes`).

| Règle | Kledg | Source |
| --- | --- | --- |
| Pas de CFE l'année de la création | L'année de la date de création de la société : « Exonérée », pas d'échéance de paiement, aucune écriture | CGI, art. 1478, II |
| Base réduite de moitié l'année suivante | Indiqué, sans acompte (pas de CFE l'année précédente) | CGI, art. 1478, II |
| Déclaration initiale 1447-C-SD | Échéance au 31 décembre de l'année de création (« avant le 1er janvier » de l'année suivante) | CGI, art. 1477, II ; formulaire 1447-C-SD |
| Déclaration modificative 1447-M-SD | Échéance le deuxième jour ouvré qui suit le 1er mai, quand le paramètre « Changements de CFE à déclarer » est activé (surface, activité, exonération) | CGI, art. 1477, I ; BOI-IF-CFE-30 |
| Acompte du 15 juin | 50 % de la CFE de l'année précédente quand elle atteignait 3 000 € ; l'avis saisi de l'année précédente décide, sinon le paramètre « Acompte de CFE » ; le montant de l'avis d'acompte saisi l'emporte | CGI, art. 1679 quinquies |
| Solde du 15 décembre | Montant de l'avis moins l'acompte ; date reportée au jour ouvrable suivant | CGI, art. 1679 quinquies |
| Cotisation minimum | Indique si le chiffre d'affaires de l'année N-2 (5 000 € ou moins) en exonère ; la base minimum, votée par la commune, n'est pas calculée | CGI, art. 1647 D ; BOI-IF-CFE-20-20-40-10 |

Exemples chiffrés (tests) : CFE 2025 de 3 500 €, avis 2026 de 4 000 € :
acompte de 1 750 € au 15 juin, solde de 2 250 € au 15 décembre ; CFE 2025 de
2 999 € : aucun acompte en 2026, même si le paramètre est activé ; société
créée le 1er mars 2026 : rien en 2026 sauf la 1447-C-SD au 31 décembre,
première CFE en 2027 sans acompte.

Une CFE de zéro sur l'avis (exonération) rend l'échéance « Non due » dans le
suivi ; un avis d'acompte de zéro aussi pour l'acompte.

### Charge prévue

Pour le budget et le mode simple, la page donne la charge de l'année au
compte **63511** « Contribution économique territoriale » (PCG), répartie
entre juin (l'acompte) et décembre (le solde) : l'avis de l'année quand il
est saisi, sinon la CFE de l'année précédente, présentée comme une
estimation. L'accueil du mode simple affiche le montant à côté de l'échéance
de CFE de la liste « À faire ».

### Écritures en brouillon

« Préparer l'acompte » et « Préparer le solde » (droit `entries:create`)
créent un **brouillon**, jamais validé
(`lib/local-taxes/prepare-cfe-entry.service.ts`) :

- contrepartie Paiement : débit du 63511, crédit de la banque (le compte
  bancaire par défaut de la société, sinon le 512), journal BQ ;
- contrepartie Charge à payer : débit du 63511, crédit du 447 « Autres
  impôts, taxes et versements assimilés », journal OD ; le rapprochement du
  paiement solde ensuite le 447.

Date : le jour du paiement enregistré dans le suivi des échéances, sinon
l'échéance. Référence `CFE-2026-AC` ou `CFE-2026-SOLDE`, dans l'exercice qui
contient la date (il doit exister et être ouvert). Les comptes prennent le
numéro du plan de l'exercice, créés au besoin. L'opération est
**idempotente** (même rédacteur de brouillons que l'impôt sur les sociétés,
verrou par société et référence et verrou de l'exercice) : un brouillon
identique est gardé, un brouillon périmé (un autre montant ou une autre date)
est remplacé, une écriture validée n'est jamais modifiée, un montant nul ne
crée rien.

## CVAE

### La loi en vigueur

La CVAE est en voie de suppression. Le calendrier de la loi de finances pour
2024 a été décalé de trois ans par la loi n° 2025-127 du 14 février 2025 de
finances pour 2025 (art. 62), et la loi de finances pour 2026 ne l'a pas
avancé (le projet le prévoyait, le texte adopté ne l'a pas retenu) :

| Année | Taux maximal | Dégrèvement sous 2 000 000 € | Plafonnement de la CET | Remarque |
| --- | --- | --- | --- | --- |
| 2023 et avant | | | | Non calculées par Kledg (autres taux, cotisation minimum) |
| 2024 | 0,28 % | 188 € | 1,531 % | |
| 2025 | 0,19 % | 125 € | 1,438 % | Plus une contribution complémentaire de 47,4 % de la CVAE, hors plafonnement |
| 2026 | **0,28 %** | 188 € | 1,531 % | **La CVAE est due en 2026** |
| 2027 | 0,28 % | 188 € | 1,531 % | |
| 2028 | 0,19 % | 125 € | 1,438 % | |
| 2029 | 0,09 % | 63 € | 1,344 % | Dernière année imposée, déclarée en mai 2030 |
| 2030 et après | **supprimée** | | 1,25 % (CFE seule) | Ni déclaration, ni acompte, ni paiement |

Sources : CGI, art. 1586 quater (version en vigueur du 1er janvier 2026 au
1er janvier 2028), BOI-CVAE-LIQ-10 du 19 novembre 2025, BOI-IF-CFE-40-30-20-30
§ 190.

### Calcul

- **Période** (CGI, art. 1586 quinquies) : les exercices clos dans l'année ;
  un exercice qui se termine plus tard dans l'année compte pendant qu'il
  court, comme une estimation sur les écritures passées.
- **Chiffre d'affaires** : comptes 70, crédit moins débit, ramené à douze mois
  pour le taux et les seuils (en mois pour un exercice du 1er à une fin de
  mois, sinon en jours sur 365).
- **Valeur ajoutée** (CGI, art. 1586 sexies, I) : la valeur ajoutée des soldes
  intermédiaires de gestion (`lib/reports/financial-indicators/sig.ts`), plus
  les subventions d'exploitation (74), les autres produits de gestion
  courante (75 hors 755) et les transferts de charges d'exploitation (791),
  moins les autres charges de gestion courante (65 hors 655). Les impôts et
  taxes (63) ne sont pas déduits, lecture prudente. Le reste est un
  **ajustement saisi** (libellé, montant signé) : loyers de plus de six mois
  ou de crédit-bail, non déductibles ; production immobilisée ; cessions
  d'immobilisations de l'activité courante ; régimes particuliers.
- **Plafond** (art. 1586 sexies, VII) : 80 % du chiffre d'affaires, 85 %
  au-delà de 7 600 000 €.
- **Seuils** : déclaration 1330-CVAE au-delà de 152 500 € de chiffre
  d'affaires (art. 1586 octies, BOI-CVAE-DECLA-10), CVAE au-delà de
  500 000 € (art. 1586 quater). Les deux seuils diffèrent : la 1330 est due
  dès 152 500 €, même sans CVAE à payer.
- **Taux** (art. 1586 quater) : 0 jusqu'à 500 000 €, puis par tranche jusqu'à
  3, 10 et 50 millions d'euros, **arrondi au centième** (exemple du BOFiP :
  2 700 000 € en 2026, 0,094 % x 2 200 000 / 2 500 000 = 0,0827 %, soit
  0,08 %), le taux maximal au-delà.
- **Dégrèvement** sous 2 000 000 € (188 € en 2026), puis **franchise** :
  pas de CVAE de 63 € ou moins (BOI-CVAE-LIQ-10 § 170 et 180).
- **Acomptes 1329-AC** des 15 juin et 15 septembre quand la CVAE de l'année
  précédente dépasse 1 500 € : chacun 50 % de la CVAE calculée aux taux de
  l'année sur la dernière valeur ajoutée déclarée (CGI, art. 1679 septies).
  Solde avec la **1329-DEF**, et déclaration **1330-CVAE**, le deuxième jour
  ouvré qui suit le 1er mai de l'année suivante.

Exemples chiffrés (tests) : 2026, chiffre d'affaires 2 700 000 €, valeur
ajoutée 1 000 000 € : 800 € ; 1 800 000 € et 1 500 000 € : valeur ajoutée
plafonnée à 1 440 000 €, taux 0,05 %, 720 € moins 188 € = 532 € ; 2028,
1 300 000 € et 940 000 € : 188 € moins 125 € = 63 €, non due ; 60 millions
d'euros et 10 millions de valeur ajoutée : 19 000 € plus 9 006 € de
contribution complémentaire en 2025, 28 000 € en 2026, 9 000 € en 2029, rien
en 2030.

La page signale quand le chiffre d'affaires appelle une déclaration que le
calendrier ne montre pas encore (paramètres « Déclaration de valeur ajoutée
(1330-CVAE) », « Liquidation de la CVAE (1329-DEF) », « Acomptes de CVAE »).

Non couverts : la taxe additionnelle pour les chambres de commerce, les frais
de gestion, les régimes particuliers de valeur ajoutée (établissements de
crédit, holdings, location), les groupes (chiffre d'affaires consolidé), la
répartition par établissement et l'effectif, la mensualisation de la CFE.

## Plafonnement de la CET

CGI, art. 1647 B sexies : la CET (CFE et CVAE) au-delà du taux de l'année de
la valeur ajoutée ouvre droit à un dégrèvement de CFE, demandé avec le
formulaire 1327-CET-SD. La page en donne une **estimation** : CFE de l'avis
plus CVAE moins le taux de la valeur ajoutée retenue, jamais plus que la CFE.
Exemple : valeur ajoutée 1 000 000 € en 2026, plafond 15 310 € ; CFE
20 000 € et CVAE 800 € : 5 490 € de dégrèvement possible.

## API et MCP

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/companies/[id]/local-taxes?year=` | `reports:read` | CFE, CVAE, plafonnement, échéances et leur statut d'une année (l'année en cours par défaut) |
| `PUT /api/companies/[id]/local-taxes { year, cfe?: { totalCents, acompteCents?, noticeOn?, note? } \| null, cvaeAdjustments? }` | `entries:create` | Avis de CFE et ajustements de la valeur ajoutée ; seules les parties envoyées changent |
| `POST /api/companies/[id]/local-taxes/entries { year, kind: acompte \| solde, counterpart?: bank \| payable }` | `entries:create` | Brouillon de CFE (201 créé ou remplacé, 200 inchangé, validé ou rien) |
| `GET /api/companies/[id]/local-taxes/export?year=&format=pdf\|csv` | `reports:export` | Le document de travail |

Outils MCP ([mcp.md](mcp.md)) : `get_local_taxes` (lecture), et pour le suivi
`list_declarations_status` et `mark_declaration` ([échéances](echeances.md)).

## Stockage

Table `local_taxes` (migration
`20261105090000_local_taxes_and_declaration_statuses`) : une ligne par
société et année (`companyId`, `year` unique). Contraintes de la base :
années de 2010 à 2100, montants jamais négatifs, acompte jamais supérieur au
total, détails de l'avis seulement avec son montant, ajustements en liste
JSON. Table d'une société : les quatre politiques `kledg_rls_*` sur
`companyId` ([rls.md](rls.md)).

## Tests

- `lib/local-taxes/__tests__/local-taxes.test.ts` : exemples chiffrés de
  chaque règle (acompte de CFE au-dessus et au-dessous de 3 000 €, société
  nouvelle, 1447-C-SD et 1447-M-SD, cotisation minimum, taux de CVAE par
  année et par tranche avec l'exemple du BOFiP, seuils de 152 500 € et
  500 000 €, plafond de valeur ajoutée, dégrèvement, franchise de 63 €,
  contribution complémentaire de 2025, années supprimées et non couvertes,
  acomptes de CVAE, échéances arrêtées en 2030, valeur ajoutée depuis les
  comptes, plafonnement).
- `lib/local-taxes/__tests__/local-taxes.db.test.ts` (PostgreSQL, aussi avec
  `KLEDG_RLS=enforce`) : CVAE depuis les écritures et ajustements, avis de
  CFE, acompte depuis l'année précédente, brouillons idempotents datés depuis
  le suivi, société nouvelle, 2030 et 2023, routes pour chaque rôle, exports,
  contraintes de la base.
- `lib/mcp/__tests__/local-tax-tools.test.ts`, la matrice des autorisations
  et l'isolation des sociétés (`lib/rls/__tests__`).

## Sources

- [CGI, art. 1447](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000023380872), [art. 1467](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030060638), [art. 1477](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030752139), [art. 1478](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051202382), [art. 1647 D](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038686433), [art. 1647 B sexies](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048860242), [art. 1679 quinquies](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033812199)
- [CGI, art. 1586 ter à 1586 nonies](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000021576521/) (CVAE), [art. 1586 quater](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048860944), [art. 1586 sexies](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043048297), [art. 1586 octies](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909509), [art. 1679 septies](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000022892181/)
- [Loi n° 2025-127 du 14 février 2025 de finances pour 2025, art. 62](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000051168728)
- [BOI-CVAE-LIQ-10](https://bofip.impots.gouv.fr/bofip/839-PGP.html/identifiant=BOI-CVAE-LIQ-10-20251119), [BOI-CVAE-DECLA-10](https://bofip.impots.gouv.fr/bofip/1091-PGP.html/identifiant=BOI-CVAE-DECLA-10-20240424), [BOI-IF-CFE-30](https://bofip.impots.gouv.fr/bofip/3957-PGP.html/identifiant=BOI-IF-CFE-30-20211201), [BOI-IF-CFE-20-20-40-10](https://bofip.impots.gouv.fr/bofip/9617-PGP.html/identifiant=BOI-IF-CFE-20-20-40-10-20190626), [BOI-IF-CFE-40-30-20-30](https://bofip.impots.gouv.fr/bofip/2594-PGP.html/identifiant=BOI-IF-CFE-40-30-20-30-20251119)
- Formulaires [1447-C-SD](https://www.impots.gouv.fr/formulaire/1447-c-sd/declaration-initiale-de-cotisation-fonciere-des-entreprises), [1330-CVAE-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/1330-cvae-sd/2026/1330-cvae-sd_5410.pdf), [1329-AC-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/1329-ac-sd/2026/1329-ac-sd_5492.pdf), 1329-DEF-SD, 1447-M-SD, 1327-CET-SD ; [impots.gouv.fr, CET, CFE et CVAE](https://www.impots.gouv.fr/professionnel/cet-cfe-et-cvae)
- PCG, liste des comptes (63511, 447, 512) et art. 1031-3 (validation des écritures)
