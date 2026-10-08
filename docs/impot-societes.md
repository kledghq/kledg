# Impôt sur les sociétés

Le guide d'utilisation (à quoi sert la fonctionnalité, étapes, règles
expliquées) est sur le site : [L'impôt sur les sociétés](https://www.kledg.com/fr/docs/l-impot-sur-les-societes).
Cette page décrit le fonctionnement technique : code, API, règles de calcul,
droits et limites d'implémentation.

Kledg calcule l'IS d'un exercice depuis les écritures validées (résultat
fiscal, déficits, taux, contribution sociale, solde, acomptes suivants,
contrôles, lignes à la main). Formulaires visés : 2065-SD et sa liasse,
2571-SD, 2572-SD. Kledg ne dépose rien, ne paie rien et ne transmet rien à
l'administration.

Page : États, Impôt sur les sociétés (`/<société>/impot-societes`, mode
expert). Code : `lib/corporate-tax`. Barèmes et règles en vigueur pour les
exercices clos en 2026, avec leurs sources ci-dessous.

## Quelle société, quels formulaires

Le régime d'imposition des bénéfices vient du champ `corporateTaxRegime` de
la société ou de l'historique des régimes, comme pour le calendrier des
échéances (`corporateTaxRegimeAt`, `lib/deadlines/engine.ts`) :

| Régime | Formulaires | Tableau du résultat fiscal |
| --- | --- | --- |
| Réel simplifié | 2065-SD et liasse 2033-SD | 2033-B-SD, lignes 312 à 372 |
| Réel normal | 2065-SD et liasse 2050 | 2058-A-SD, lignes WA à XO |
| Micro, ou forme à l'impôt sur le revenu sans régime d'IS (EI, SCI, SNC, SCS) | Aucun | La page dit qu'il n'y a rien à calculer |
| Non renseigné (une autre forme) | Aucun | La page demande de renseigner le régime |

Par défaut, la page ouvre le dernier exercice clos dont le solde n'est pas
encore dû (dans les quatre mois qui suivent la clôture), sinon l'exercice en
cours. Chaque échéance d'IS de la page Échéances porte un lien : le solde et
la liasse ouvrent leur exercice, un acompte ouvre l'exercice précédent, sur
lequel il est calculé (`lib/corporate-tax/deadline-links.ts`).

## Du résultat comptable au résultat fiscal

Le point de départ est le résultat du compte de résultat de l'exercice,
écritures validées, écriture de clôture (journal CL) exclue
(`loadStatementAccounts`, `computeSig`). Kledg n'ajoute que ce qu'un compte
dit avec certitude :

| Ligne | Compte | Règle | 2033-B | 2058-A |
| --- | --- | --- | --- | --- |
| Réintégration | 695 (sauf 6954) et 696, débit net | L'impôt sur les sociétés et la contribution sociale ne sont pas déductibles (CGI, art. 213 ; art. 235 ter ZC) | 324 | I7 |
| Déduction | 695 et 696, crédit net | Un impôt repris n'est pas un produit imposable | 350 | XG |
| Réintégration | 63514 | Taxes annuelles sur les véhicules (CIBS, art. L. 421-94), non déductibles (CGI, art. 213) | 324 | WG |
| Réintégration | 6582 (PCG 2025), 6712 (anciens plans) | Sanctions pécuniaires et pénalités (CGI, art. 39, 2). Les pénalités contractuelles (6581, ancien 6711) restent déductibles | 330 | WJ |
| Déduction | 699 | Créance de report en arrière des déficits, non imposable (CGI, art. 220 quinquies) | 350 | XG |
| Déduction | 761 | Dividendes d'une filiale détenue à 5 % au moins (régime des sociétés mères, CGI art. 145) | 350 | XA |
| Réintégration | | Quote-part de frais et charges de 5 % de ces dividendes (CGI, art. 216) | 330 | XA (case 2A) |

Le résultat ainsi obtenu est arrondi à l'euro, comme les formulaires le
demandent.

**Régime des sociétés mères.** Kledg lit les dividendes (761) reçus de chaque
société du groupe et la participation que les associés de la filiale
enregistrent (`lib/group`, [vue groupe](vue-groupe.md)), avec les droits de
l'utilisateur dans chaque filiale : une filiale hors de son accès n'est pas
lue et le contrôle le signale. La ligne rappelle ce que Kledg ne peut pas
vérifier : titres nominatifs, conservés deux ans, option sur la déclaration.
Les autres dividendes restent imposables, avec un contrôle « Produits de
participations à examiner ». Le taux de 1 % des groupes intégrés n'est pas
couvert. L'accueil du mode simple calcule sans les filiales (estimation).

**Lignes à la main.** Tout le reste s'ajoute en réintégration, en déduction
ou en crédit d'impôt, avec un libellé et un montant (ligne 330 ou 350 de la
2033-B, WQ ou XG de la 2058-A par défaut) :

- dépenses somptuaires et charges de l'article 39, 4 du CGI, dont le
  montant est soumis à l'approbation des associés (art. 223 quater) ;
- amortissements excédentaires des voitures particulières (le plafond dépend
  du taux de CO2, que Kledg ne connaît pas) ;
- avantages personnels, rémunérations excessives, cadeaux au-delà des
  limites, provisions non déductibles et reprises déjà taxées ;
- intérêts excédentaires des comptes courants d'associés (CGI, art. 39, 1,
  3° et 212) ;
- plus-values à long terme et quote-part de 12 % ;
- dividendes que les associés enregistrés ne montrent pas ;
- réductions et crédits d'impôt (recherche, mécénat, famille...) ;
- report en arrière (2039-SD), exonérations, intégration fiscale.

Les réceptions (6257) et les impôts étrangers (6954) sont signalés par les
contrôles, jamais ajustés d'office.

## Déficits reportables

CGI, art. 209, I ; BOI-IS-DEF-10-30. Les déficits antérieurs s'imputent sur
le bénéfice dans la limite de 1 000 000 €, majorée de 50 % du bénéfice qui
dépasse ce montant ; le reste se reporte sans limite de durée. La limite vaut
par exercice, sans prorata. Une perte s'ajoute aux déficits.

Les déficits au début d'un exercice viennent, dans l'ordre :

1. du montant saisi pour cet exercice (le premier exercice tenu dans Kledg,
   ou une correction) ;
2. du report de l'exercice précédent, calculé depuis son dépôt enregistré :
   déficits au début, moins imputés, plus déficit de l'exercice ;
3. de zéro pour le premier exercice d'une société nouvelle.

Sinon ils sont inconnus : le calcul les compte à zéro et un contrôle demande
de les renseigner. La page montre l'historique par exercice.

## Taux

CGI, art. 219, I ; BOI-IS-LIQ-20-10.

- Taux normal : 25 %.
- Taux réduit : 15 % jusqu'à 42 500 € de bénéfice par période de douze mois,
  pour une société dont le chiffre d'affaires de l'exercice, ramené à douze
  mois, n'excède pas 10 000 000 € (« n'excédant pas » : 10 000 000 € pile
  reste éligible), dont le capital est entièrement libéré et détenu de
  manière continue pour 75 % au moins par des personnes physiques,
  directement ou par des sociétés qui remplissent les mêmes conditions.

Ce que Kledg sait de chaque condition :

| Condition | Source |
| --- | --- |
| Chiffre d'affaires | Calculé : comptes 70, crédit moins débit, ramené à douze mois |
| Capital entièrement libéré | La réponse de l'utilisateur ; sinon « non » quand les comptes le montrent (109 ou 4562 débiteur, 1011 ou 1012 créditeur), sinon à répondre |
| 75 % de personnes physiques | La réponse de l'utilisateur ; sinon « oui » quand les associés enregistrés totalisent 100 % et que les personnes physiques en détiennent 75 % au moins, sinon à répondre (une détention par des sociétés peut compter) |

Une question sans réponse fait calculer tout le bénéfice à 25 %, jamais
moins que l'impôt réel, et la page indique ce que donnerait le taux réduit.

**Exercice de plus ou de moins de douze mois.** Le plafond de 42 500 € et
l'abattement de la contribution sociale sont proratisés : en mois quand
l'exercice va d'un 1er à une fin de mois (six mois : 21 250 €, dix-huit
mois : 63 750 €), sinon en jours sur 365. Le chiffre d'affaires est ramené à
douze mois de la même façon. Le plafond est arrondi à l'euro.

**Contribution sociale** (CGI, art. 235 ter ZC) : 3,3 % de l'impôt sur les
sociétés diminué d'un abattement de 763 000 € par période de douze mois.
Exonérées : les sociétés dont le chiffre d'affaires, ramené à douze mois, est
inférieur à 7 630 000 € et qui remplissent les conditions de capital du taux
réduit. Ses acomptes (art. 1668 D) ne sont pas calculés.

**Crédits d'impôt** : lignes saisies, déduites de ce qui se paie avec le
relevé de solde, jamais de l'impôt qui sert de référence aux acomptes.

## Solde (2572-SD)

L'impôt de l'exercice (IS et contribution sociale, moins les crédits), moins
les acomptes versés pour cet exercice, se paie avec le relevé de solde au
plus tard le 15 du quatrième mois qui suit la clôture, le 15 mai pour une
clôture au 31 décembre (CGI, art. 1668 ; la date et son report au jour
ouvrable suivant viennent du calendrier). Un montant négatif est un excédent
à demander en remboursement sur le relevé.

Les acomptes versés se saisissent sur la page (numéro, date, montant). Un
contrôle les compare aux débits du compte 444 de l'exercice (hors écriture
de charge d'impôt).

## Acomptes de l'exercice suivant (2571-SD)

CGI, art. 1668 ; BOI-IS-DECLA-20-10 ; BOI-IS-DECLA-20-30.

- Chaque acompte est le quart de l'impôt calculé sur le bénéfice de
  référence, ramené à douze mois, aux taux de l'article 219 (15 % jusqu'à
  42 500 € si la société a eu le taux réduit, 25 % au-delà), arrondi à
  l'euro (§ 60 et 110). La référence est le dépôt enregistré de l'exercice
  quand il existe, la feuille de calcul sinon.
- Le premier acompte tombe avant que la déclaration de l'exercice soit due :
  il se calcule sur l'exercice précédent et le deuxième le régularise, pour
  que les deux premiers fassent la moitié de l'impôt de référence (§ 120 à
  130). Ce qu'il a versé en trop s'impute sur les suivants. Pour une société
  nouvelle, ce premier acompte n'est pas dû et le deuxième régularise
  (BOI-IS-DECLA-20-30). Si l'exercice précédent n'a pas de dépôt enregistré,
  les deux premiers montants restent à calculer.
- Aucun acompte quand l'impôt de référence ne dépasse pas 3 000 €, jugé à
  chaque échéance (§ 360 et 370).
- Les dates sont celles du calendrier (`isAcompteDates`) : 15 mars, 15 juin,
  15 septembre, 15 décembre pour un exercice civil, dans l'ordre que fixe la
  date de clôture, autant d'acomptes que l'exercice compte d'échéances
  trimestrielles. Pas d'acompte pendant le premier exercice.

Non couverts : le cinquième acompte des sociétés dont le chiffre d'affaires
dépasse 250 M€, la modulation du dernier acompte, les acomptes de la
contribution sociale.

## Contrôles

`lib/corporate-tax/checks.ts`. Un contrôle « à corriger » rend les chiffres
incomplets.

| Contrôle | Gravité | Règle |
| --- | --- | --- |
| Écritures en brouillon de l'exercice | À corriger | Seules les écritures validées font le résultat (PCG art. 1031-3). Les brouillons d'IS préparés par Kledg (références `IS-`) ne comptent pas |
| Opérations bancaires non rapprochées de l'exercice | À corriger | Leurs charges ou produits manquent peut-être |
| Exercice en cours | Information | L'impôt est une estimation sur les écritures passées |
| Conditions du taux réduit | À vérifier | Une question sans réponse |
| Déficits reportables | À vérifier | Ni saisis ni connus par l'historique |
| Produits de participations | À vérifier | 761 hors filiales détenues à 5 % |
| Filiales hors accès | Information | Leur participation et leurs dividendes ne sont pas lus |
| Réceptions, impôts étrangers | Information | 6257, 6954 : déductibilité à juger |
| Intégration fiscale | À vérifier | Le compte 698 a bougé ; non couvert |
| Acomptes | À vérifier | Acomptes saisis différents des débits du 444 |

## Écritures préparées

En **brouillon** seulement, jamais validées
(`lib/corporate-tax/prepare-corporate-tax-entries.service.ts`), droit
`entries:create` :

- **Charge d'impôt** : au dernier jour de l'exercice, journal OD, référence
  `IS-<année>`, débit du 695 « Impôts sur les bénéfices » et crédit du 444
  « État, impôts sur les bénéfices » de l'impôt et de la contribution sociale.
  Les crédits d'impôt se comptabilisent à part. Une fois validée, la charge
  est réintégrée par la ligne du 695 : l'impôt calculé ne change pas.
- **Paiement d'un acompte** de l'exercice suivant : à sa date, journal BQ,
  référence `IS-AC-<année>-<n>`, débit du 444 et crédit de la banque (le
  compte bancaire par défaut de la société, sinon le 512), dans l'exercice
  qui le paie (il doit exister).

Les comptes prennent le numéro du plan de l'exercice (695, 444000...),
créés au besoin. L'opération est **idempotente**, sous un verrou par société
et référence et le verrou de l'exercice : un brouillon identique est gardé,
un brouillon périmé est supprimé et préparé de nouveau, une écriture validée
n'est jamais modifiée (elle se corrige par contre-passation), un montant nul
ne crée rien.

## Dépôt enregistré

Une fois la déclaration déposée, « Enregistrer le dépôt » garde la date, le
résultat fiscal avant déficits, les déficits imputés, l'impôt aux taux de
l'article 219 et le taux réduit appliqué. L'exercice suivant s'en sert pour
ses déficits et ses acomptes.

Table `corporate_tax_returns` (migration
`20261104090000_corporate_tax_returns`) : une ligne par exercice
(`fiscalYearId` unique avec `companyId`, clé étrangère composite vers
l'exercice de la même société). Elle garde aussi les réponses du taux réduit,
les déficits saisis, les lignes à la main et les acomptes versés. Contraintes
de la base : déficits jamais négatifs, dépôt enregistré en entier ou pas du
tout, impôt et déficits imputés jamais négatifs, listes JSON. Table d'une
société : les quatre politiques `kledg_rls_*` sur `companyId`
([rls.md](rls.md)).

## Export

PDF (document de travail, jamais le formulaire officiel) et CSV (séparateur
« ; », virgule décimale, BOM UTF-8, cellules protégées contre les formules),
droit `reports:export`, limite `export`. Mêmes lignes, montants, acomptes,
contrôles, lignes à la main et sources que la page.

## Mode simple

L'accueil du mode simple affiche, à côté du bénéfice « Bénéfice depuis
janvier, avant impôt », la carte « Impôt sur les sociétés estimé » : l'impôt
de l'exercice en cours calculé comme ici sur les écritures passées, sans les
dividendes de filiales, avec la mention « Estimation sur le bénéfice depuis
janvier, à confirmer à la clôture ». Rien pour une société à l'impôt sur le
revenu ou sans régime ([mode simple](mode-simple.md)).

## API et MCP

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/companies/[id]/corporate-tax?fiscalYearId=&deadline=` | `reports:read` | La feuille de calcul d'un exercice (celui dont le solde est dû par défaut, ou celui d'une échéance du calendrier) |
| `GET /api/companies/[id]/corporate-tax/export?fiscalYearId=&format=pdf\|csv` | `reports:export` | Le document de travail |
| `PUT /api/companies/[id]/corporate-tax/inputs { fiscalYearId, capitalPaidUp?, naturalPersons75?, deficitsOpeningCents?, manualLines?, acomptesPaid? }` | `entries:create` | Réponses, déficits, lignes à la main, acomptes versés ; seuls les champs envoyés changent |
| `PUT /api/companies/[id]/corporate-tax/filing { fiscalYearId, filedOn, resultBeforeDeficitsCents, deficitsImputedCents, corporateTaxCents, reducedRate }` | `entries:create` | Enregistre le dépôt |
| `DELETE /api/companies/[id]/corporate-tax/filing?fiscalYearId=` | `entries:create` | Retire l'enregistrement |
| `POST /api/companies/[id]/corporate-tax/entries { fiscalYearId, kind: charge }` ou `{ fiscalYearId, kind: acompte, number }` | `entries:create` | Brouillon de charge ou de paiement d'acompte (201 créé ou remplacé, 200 inchangé, validé ou nul) |

Outils MCP ([mcp.md](mcp.md)) : `get_corporate_tax` (lecture) et
`prepare_corporate_tax_entry` (brouillons, `kledg:write`). Aucun ne dépose ni
ne paie.

## Tests

- `lib/corporate-tax/__tests__/compute.test.ts` : exemples chiffrés, taux
  réduit et non éligible, question sans réponse, exercices de six et de
  dix-huit mois et en jours, arrondis, déficits avec le plafond de
  1 000 000 € et 50 %, contribution sociale et son seuil, réintégrations
  lues dans les comptes, régime des sociétés mères, acomptes (régularisation,
  exemption sous 3 000 €, société nouvelle, exercice court), solde, contrôles,
  liens avec le calendrier.
- `lib/corporate-tax/__tests__/corporate-tax.db.test.ts` (PostgreSQL, aussi
  avec `KLEDG_RLS=enforce`) : feuille de calcul d'une SAS, réponses, acomptes
  de l'exercice suivant, acomptes versés et compte 444, brouillons
  idempotents, dépôt et historique, déficits qui absorbent un bénéfice, SCI à
  l'impôt sur le revenu, régime manquant, dividendes d'une filiale à 60 %,
  accueil du mode simple, routes pour chaque rôle, contraintes de la base.
- `lib/mcp/__tests__/corporate-tax-tools.test.ts`,
  `components/features/corporate-tax/__tests__/corporate-tax-page.test.tsx`,
  la matrice des autorisations et l'isolation des sociétés
  (`lib/rls/__tests__`).

## Sources

- [CGI, art. 219](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046868562) (taux) et [BOI-IS-LIQ-20-10](https://bofip.impots.gouv.fr/bofip/2062-PGP.html/identifiant=BOI-IS-LIQ-20-10-20230621) (taux réduit des PME)
- [CGI, art. 209](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909650/) (déficits) et [BOI-IS-DEF-10-30](https://bofip.impots.gouv.fr/bofip/2103-PGP.html/identifiant=BOI-IS-DEF-10-30-20130410)
- [CGI, art. 213](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006303491) (impôt et taxes sur les véhicules non déductibles), [art. 39](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053542680) (2 : sanctions et pénalités ; 4 : dépenses somptuaires), art. 223 quater (approbation des dépenses somptuaires)
- [CGI, art. 145](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051203497) et [art. 216](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048831340) (régime des sociétés mères), [BOI-IS-BASE-10-10](https://bofip.impots.gouv.fr/bofip/4516-PGP.html/identifiant=BOI-IS-BASE-10-10-20200415)
- [CGI, art. 235 ter ZC](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031011715) (contribution sociale) et [BOI-IS-AUT-10-30](https://bofip.impots.gouv.fr/bofip/3493-PGP.html/identifiant=BOI-IS-AUT-10-30-20130318)
- [CGI, art. 1668](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033836779/) (acomptes et solde), [BOI-IS-DECLA-20-10](https://bofip.impots.gouv.fr/bofip/3558-PGP.html) et [BOI-IS-DECLA-20-30](https://bofip.impots.gouv.fr/bofip/3564-PGP.html/identifiant=BOI-IS-DECLA-20-30-20200610) (sociétés nouvelles)
- [Liasse 2033-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/2033-sd/2026/2033-sd_5394.pdf) (tableau 2033-B-SD) et sa [notice n° 2033-NOT-SD](https://www.impots.gouv.fr/sites/default/files/formulaires/2033-sd/2026/2033-sd_5395.pdf) ; [liasse 2050 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/2050-liasse/2026/2050-liasse_5320.pdf) (tableau 2058-A-SD)
- Formulaires [2065-SD](https://www.impots.gouv.fr/formulaire/2065-sd/impot-sur-les-societes), [2571-SD](https://www.impots.gouv.fr/formulaire/2571-sd/releve-dacompte-dis) et [2572-SD](https://www.impots.gouv.fr/formulaire/2572-sd/releve-de-solde)
- PCG, liste des comptes (444, 695, 6582, 63514, 761) et art. 1031-3 (validation des écritures)
