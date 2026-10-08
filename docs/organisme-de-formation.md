# Organisme de formation

Le guide d'utilisation (déclaration d'activité, mention d'exonération, coefficient de déduction, BPF et taxe sur les salaires expliqués, étapes) est sur le site : [Organisme de formation : TVA et bilan pédagogique](https://www.kledg.com/fr/docs/organisme-de-formation). Cette page décrit le fonctionnement technique : code, API, règles de calcul, droits et limites d'implémentation.

Périmètre : organismes de formation professionnelle continue et sociétés dont
une partie des opérations est exonérée de TVA. Kledg prépare, ne dépose rien.
Règles vérifiées le 5 octobre 2026 sur Légifrance, le BOFiP, impots.gouv.fr et
service-public.gouv.fr.

Pages : Société, Informations, Établissements (déclaration d'activité) ;
États, Coefficient de déduction de TVA (`/<société>/coefficient-tva`), Taxe
sur les salaires (`/<société>/taxe-sur-les-salaires`) et Bilan pédagogique et
financier (`/<société>/bilan-pedagogique-financier`), en mode expert. Les
deux premières sont listées pour une société exonérée, assujettie partielle
ou dont un établissement est organisme de formation, la troisième pour un
organisme de formation (`lib/companies/nav-features.ts`) ; toutes restent
accessibles par leur adresse. Code : `lib/vat-deduction`,
`lib/training-report`, `lib/payroll-tax`, `lib/invoices/vat-exemptions.ts`.

## Déclaration d'activité

Un établissement (SIRET) peut être déclaré organisme de formation, avec son
numéro de déclaration d'activité (NDA) et sa date. La déclaration est
adressée au préfet de région (Code du travail, art. R6351-1) et enregistrée
par la DREETS, DRIEETS en Île-de-France, qui a remplacé la DIRECCTE le
1er avril 2021 (décret n° 2020-1545 du 9 décembre 2020, art. 30). Sans BPF,
ou si le BPF ne montre aucune activité, la déclaration devient caduque
(art. L6351-6).

## Exonération de TVA de la formation et mention sur les factures

La formation professionnelle continue assurée par une personne de droit privé
titulaire de l'attestation de l'autorité administrative est exonérée (CGI,
art. 261, 4, 4° a). L'exonération s'impose : pas d'option pour la taxation
(BOI-TVA-CHAMP-30-10-20-50 §280). La certification Qualiopi est sans
incidence (BOI-RES-TVA-000151). Les autres prestations (conseil, location de
salles) restent taxées.

Une ligne de facture de vente à 0 % peut être marquée « Exonérée, formation »
(`InvoiceLine.vatExemption = 'training'`, contrainte de la base : seulement à
0 %). La facture porte alors la référence de l'exonération (CGI, ann. II,
art. 242 nonies A, I, 12° ; BOI-TVA-DECLA-30-20-20-10 §490 et §500) :
« Exonération de TVA, article 261, 4, 4° a du CGI » par défaut, ou le texte
de la société (page Factures de vente, `PUT /api/companies/[id]/vat-settings
{ vatExemptionMention }`). Sur une facture mixte, la mention nomme les lignes
exonérées ; jamais une ligne taxée. Kledg n'émet pas de facture et n'en
génère pas de PDF : la mention est donnée sur la fiche de la facture, par
l'API (`vatExemptionMentions` de `GET /api/invoices/[id]`) et l'outil MCP
`get_invoice`, à reporter sur le document émis par votre outil de facturation.

## Coefficient de déduction de TVA

Une société qui réalise des opérations taxées et des opérations exonérées
déduit la TVA d'un bien ou d'un service « à proportion de son coefficient de
déduction » (CGI, ann. II, art. 205), produit des coefficients
d'assujettissement, de taxation et d'admission (art. 206, I). Kledg remplace
l'ancien prorata mensuel des recettes avec TVA, sans base légale.

| Règle | Kledg | Source |
| --- | --- | --- |
| Qui | Société exonérée (`isVatExempt`) ou assujettie partielle (réglage « Assujetti partiel » de la page, `partialVatDeduction`) ; franchise en base : aucune déduction ; toute autre société : déduction complète, rien ne change | CGI, art. 293 B ; ann. II, art. 205 |
| Coefficient de taxation | Chiffre d'affaires ouvrant droit à déduction / chiffre d'affaires des opérations dans le champ de la TVA, de l'année civile, hors taxe ; les ventes exonérées de formation au dénominateur seulement ; les cessions d'immobilisations, débours, subventions non imposables et produits financiers accessoires hors des deux termes | ann. II, art. 206, III, 3 ; BOI-TVA-DED-20-10-20 §50, §90, §100, §140, §150 |
| Arrondi | Chaque coefficient arrondi par excès au pourcentage entier, puis leur produit (0,66 x 0,84 = 0,5544 donne 56 %) | ann. II, art. 206, V, 2 ; BOI-TVA-DED-20-10-40 §1 |
| Coefficient provisoire | Celui, définitif, de l'année précédente ; pour une première année, l'estimation saisie (à défaut, Kledg prend les comptes de l'année à ce jour et le signale : aucun texte consulté ne fixe la méthode d'une première année) | BOI-TVA-DED-20-10-40, exemple 3 |
| Coefficient définitif et régularisation | Arrêté avant le 25 avril de l'année suivante ; TVA supportée x définitif, moins la TVA réellement déduite dans l'année (784 x 0,5 - 352,80 = 39,20 € dans l'exemple du BOFiP), quelle que soit l'importance de l'écart | ann. II, art. 206, V, 2 et 207, I ; BOI-TVA-DED-20-10-40, exemple 3 ; BOI-TVA-DED-20-10-20 §460 |
| Ligne de la déclaration | Complément : CA3 ligne 21 (case 0059), CA12 ligne 25 ; reversement : CA3 ligne 15 (case 0600), CA12 ligne 18 ; coefficient de taxation unique : CA3 ligne 22A, CA12 ligne 25A | Notices 3310-CA3-SD et 3517-S-SD 2026 |
| Coefficient d'assujettissement | Saisi (100 % par défaut) | ann. II, art. 206, II |
| Coefficient d'admission | Appliqué dépense par dépense (véhicules de tourisme, carburant, cadeaux), comme avant | ann. II, art. 206, IV |

### D'où viennent les recettes

Chaque compte de classe 7 de l'année (écritures validées, à-nouveaux et
clôture exclus) se lit ainsi (`lib/vat-deduction/revenue.ts`) :

1. un réglage de la société sur le compte ou une de ses racines (la plus
   longue l'emporte : `7062` avant `706`) : ouvre droit à déduction
   (ventes taxées, exportations, livraisons intracommunautaires), exonérée,
   ou exclue du calcul ;
2. sans réglage, un compte 70 : la part des écritures qui collectent de la
   TVA (4457, sauf 44578) ouvre droit à déduction ; les lignes de factures
   de vente marquées exonérées sont exonérées ; le reste (ventes sans TVA ni
   exonération) est **à classer** et compte comme exonéré en attendant,
   lecture prudente (une exportation laissée là baisse la déduction, jamais
   ne l'augmente) ;
3. les autres comptes de classe 7 (71 à 79) sont exclus par défaut.

### Où le coefficient s'applique

Le coefficient provisoire de l'année de l'opération s'applique à la TVA
déductible des factures d'achat comptabilisées
(`lib/invoices/posting-plan.ts`, la part non déductible s'ajoute aux lignes
de charge au prorata des bases), du mode simple, des règles d'affectation
(`vatDeductionShareOn`, `lib/vat-deduction/coefficient.ts`) et des notes de
frais (coefficient du jour de chaque ligne, `lib/expense-reports/deduction.ts`). La TVA autoliquidée (services d'un prestataire non établi en France, acquisitions intracommunautaires, achats de l'article 283-1, importations) est due en entier au 4452 et déduite au coefficient, le reste dans la charge, dans les règles d'affectation, leur aperçu, le mode simple et les modèles du rapprochement (`lib/vat-deduction/share.ts`) : 1 000 € de services à 20 % et un coefficient de 60 % donnent 200 € dus, 120 € déduits et 80 € de charge en plus. Les écritures
déjà passées ne changent pas. Le coefficient ne réduit jamais la TVA
collectée : une vente taxée d'une société partiellement exonérée porte sa TVA
au 44571 comme toute autre (CGI, art. 256) ; en mode simple, une vente
exonérée se saisit avec la réponse « Sans TVA ». Seule la franchise en base ne
collecte rien (art. 293 B).

### Régularisation en brouillon

« Préparer l'écriture » (droit `entries:create`, année terminée) crée un
brouillon au journal OD daté du 31 mars de l'année suivante, référence
`COEF-TVA-<année>`, pour la déclaration déposée en avril : complément 44566 /
758, reversement 658 / 44566 (comptes par défaut, à reventiler si besoin
avant validation). La régularisation est la TVA supportée multipliée par le coefficient
définitif, moins la TVA déduite de l'année (44562 et 44566, liquidations
exclues). La TVA supportée est celle saisie, sinon la TVA déduite divisée par
le coefficient provisoire, seulement quand un même coefficient s'est appliqué
toute l'année (celui de l'année précédente, ou une estimation saisie avant
toute déduction). Elle doit être saisie avec un coefficient provisoire de 0 %,
pour une première année sans estimation (le coefficient suivait les comptes à
ce jour) et quand l'estimation, le coefficient d'assujettissement ou la
déduction par coefficient ont changé après des déductions de l'année (la page
le signale avec la date du changement).
Idempotent (même rédacteur de brouillons que l'impôt sur les sociétés). La
déclaration de TVA lit cette écriture à part : ligne 21 ou 15.

Non couverts : un coefficient de taxation propre à une dépense utilisée
seulement pour des opérations taxées (1) ou seulement exonérées (0), les
secteurs distincts d'activité (ann. II, art. 209, BOI-TVA-DED-20-20), les
régularisations annuelles des immobilisations sur cinq ou vingt ans
(art. 207, II), les régularisations globales (cession, changement
d'affectation).

## Bilan pédagogique et financier

Chaque prestataire déclaré adresse avant le 30 avril de chaque année, sur Mon
Activité Formation, le bilan de son **dernier exercice comptable clos**
(Code du travail, art. L6352-11, R6352-22, R6352-23 ; cerfa n° 10443*17,
notice n° 50199#17). Kledg le prépare par exercice, le dernier clos par
défaut.

| Cadre | Kledg |
| --- | --- |
| A. Identification | Établissements organismes de formation (SIRET, NDA) |
| B. Informations générales | Dates de l'exercice ; formation à distance saisie (oui, non) |
| C. Origine des produits | Depuis les comptes 70 et 74 de l'exercice : l'origine du client de l'écriture (compte auxiliaire sur un 41), sinon celle du compte (racine la plus longue), sinon « à affecter », jamais devinée. Lignes 1, a à h, 2 (total a à h), 3 à 11, total, part du chiffre d'affaires global (comptes 70) en pourcentage entier, 1 % au moins quand il y a une activité ; montants arrondis à l'euro |
| D. Charges | Depuis les comptes (classe 6 hors 69 pour le total, 6411 pour les salaires des formateurs, 604 et 6226 pour les achats et honoraires de formation, comptes cités par la notice), sauf montant saisi : seule la société sait quelles charges relèvent de la formation |
| E, F-1 à F-4, G | Saisis : formateurs, stagiaires par type, activité confiée, objectifs (RNCP par niveau, RS, CQP, autres, bilans de compétences, VAE), cinq spécialités avec leur code NSF, stagiaires confiés par un autre organisme |
| Contrôles | Total F-1 = total F-3 = total F-4 (nombre et heures), niveaux RNCP dans la ligne a, F-2 dans F-1, recettes sans origine, ligne 10 sans cadre G |

L'export CSV reprend les cadres dans l'ordre du formulaire, à recopier sur
Mon Activité Formation. Échéance du calendrier : le 29 avril (« avant le
30 avril ») de l'année qui suit la clôture ; le ministère prolonge la
campagne chaque année par annonce (jusqu'au 31 mai en 2026, DREETS) :
seules les prolongations annoncées sont affichées
(`lib/training-report/deadline.ts`).

## Taxe sur les salaires

| Règle | Kledg | Source |
| --- | --- | --- |
| Redevable | Employeur non soumis à la TVA, ou soumis sur moins de 90 % de son chiffre d'affaires de l'année civile précédant le paiement ; pas d'une société en franchise en base | CGI, art. 231, 1 |
| Rapport d'assujettissement | Recettes sans droit à déduction / total des recettes de l'année précédente, lues comme pour le coefficient de taxation ; arrondi à l'unité inférieure (faculté) ; de 10 à 20 %, le tableau de lissage (10 donne 0, 11 donne 2... 20 donne 20) ; un rapport saisi l'emporte (première année, recettes hors du champ de la TVA) | BOI-TPS-TS-20-30 §80 et §220 ; notice 2502 |
| Assiette | Base annuelle de chaque salarié, saisie : rémunérations retenues pour la CSG, sans l'abattement de 1,75 % ; les comptes 641 et 644 servent de contrôle | CGI, art. 231, 1 |
| Calcul | Bases additionnées par tranche (A, A1, A2) puis arrondies à l'euro ; 4,25 % de A, 4,25 % de plus sur A1, 9,35 % de plus sur A2 (taux de 8,50 % et 13,60 %), chacun arrondi ; rapport appliqué au total | art. 231, 2 bis ; notice 2502, exemple 5 |
| Seuils | 2025 : 9 147 € et 18 259 € ; 2026 : 9 229 € et 18 423 € par salarié et par an ; autres années non calculées | Notices 2501-SD 2025 et 2026 |
| Franchise et décote | Rien de dû jusqu'à 1 200 € ; jusqu'à 2 040 €, décote de 3/4 de la différence | CGI, art. 1679 |
| Abattement | Associations, fondations, syndicats, mutuelles : 24 041 € en 2025, 24 256 € en 2026, après franchise et décote, jamais remboursé | CGI, art. 1679 A ; notice 2502 C.4 ; BOI-TPS-TS-30 §560 |
| Paiement | Relevés 2501 mensuels si la taxe de l'année précédente dépassait 10 000 €, trimestriels de 4 000 € à 10 000 € (15 avril, 15 juillet, 15 octobre), sinon annuel ; pas de relevé pour décembre ni le 4e trimestre ; déclaration 2502 et solde au 15 janvier (31 janvier admis) | ann. III, art. 369 ; notice 2501 ; BOI-TPS-TS-40 §280 |
| Écriture | Brouillon 6311 / 447 au 31 décembre, référence `TS-<année>` | PCG, liste des comptes |

La taxe de l'année précédente vient de Kledg quand ses bases y sont saisies,
sinon du montant saisi. Le calendrier lit la situation enregistrée avec les
rémunérations (redevable, fréquence), sans relire les comptes. Non couverts :
taux des DOM, exonérations particulières (art. 231 bis), secteurs distincts,
calcul mois par mois des relevés (seuils au douzième ou au quart) et
régularisation de fin d'année.

## API et MCP

| Route | Droit | Outil MCP |
| --- | --- | --- |
| `GET /api/companies/[id]/vat-deduction?year=` | `reports:read` | `get_vat_deduction_coefficient` |
| `PUT /api/companies/[id]/vat-deduction` | `entries:create` | `save_vat_deduction_settings` |
| `POST /api/companies/[id]/vat-deduction/regularisation { year }` | `entries:create` | `prepare_vat_coefficient_regularisation` (brouillon) |
| `GET /api/companies/[id]/training-report?fiscalYearId=` | `reports:read` | `get_training_report` |
| `PUT /api/companies/[id]/training-report { fiscalYearId, data }` | `entries:create` | `save_training_report` |
| `PUT /api/companies/[id]/training-report/origins { accounts?, customers? }` | `entries:create` | `save_training_origins` |
| `GET /api/companies/[id]/training-report/export?fiscalYearId=&format=csv` | `reports:export` | `export_report` (`training_report`) |
| `GET /api/companies/[id]/payroll-tax?year=` | `reports:read` | `get_payroll_tax` |
| `PUT /api/companies/[id]/payroll-tax { year, data }` | `entries:create` | `save_payroll_tax` |
| `POST /api/companies/[id]/payroll-tax/entries { year }` | `entries:create` | `prepare_payroll_tax_entry` (brouillon) |

## Stockage

Migration `20261116090000_training_organisations` : colonnes
`companies.partialVatDeduction` et `vatExemptionMention`,
`invoice_lines.vatExemption`, `tiers.trainingOrigin` ; tables
`vat_deduction_years` (société et année), `revenue_account_settings`
(société et compte : traitement de TVA, origine du BPF), `training_reports`
(société et exercice) et `payroll_tax_years` (société et année). Contraintes
de la base sur les pourcentages, codes, années et formes JSON. Tables d'une
société : les quatre politiques `kledg_rls_*` sur `companyId`
([rls.md](rls.md)).

## Tests

- `lib/vat-deduction/__tests__/rules.test.ts` : arrondis par excès (exemples
  du BOFiP), coefficient provisoire, régularisation de l'exemple du BOFiP
  (39,20 €), lignes de la déclaration, lecture des recettes.
- `lib/invoices/__tests__/posting-plan.test.ts`, `vat-exemptions.test.ts` :
  déduction partielle des factures d'achat, mention seulement sur les lignes
  exonérées.
- `lib/training-report/__tests__/compute.test.ts` : origine par client puis
  par compte, arrondis, ligne 2, part du chiffre d'affaires, cadre D,
  contrôles de la notice, échéance.
- `lib/payroll-tax/__tests__/rules.test.ts` : barèmes 2025 et 2026, exemple 5
  de la notice 2502, rapport et lissage, franchise, décote, abattement,
  fréquence et dates.
- `lib/deadlines/__tests__/training-deadlines.test.ts` : BPF et taxe sur les
  salaires dans le calendrier.
- `lib/training-report/__tests__/training-organisation.db.test.ts`
  (PostgreSQL, aussi avec `KLEDG_RLS=enforce`) : une année complète, routes
  pour chaque rôle, autre société refusée, contraintes de la base.
- `lib/mcp/__tests__/training-tools.test.ts`, les pages
  (`components/features/vat-deduction`, `training-report`, `payroll-tax`),
  la matrice des autorisations.

## Sources

- [CGI, ann. II, art. 205 et 206](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/), [art. 207](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031699880), [art. 242 nonies A](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276)
- [CGI, art. 261, 4, 4° a](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909959/), [art. 293 B](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045035275), [art. 231](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051764961), [art. 1679](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000026950015), [art. 1679 A](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049641164)
- [BOI-TVA-DED-20-10](https://bofip.impots.gouv.fr/bofip/1637-PGP.html), [BOI-TVA-DED-20-10-20](https://bofip.impots.gouv.fr/bofip/1665-PGP.html), [BOI-TVA-DED-20-10-40](https://bofip.impots.gouv.fr/bofip/1674-PGP.html), [BOI-TVA-DED-60-10](https://bofip.impots.gouv.fr/bofip/1678-PGP.html), [BOI-TVA-DED-20-20](https://bofip.impots.gouv.fr/bofip/1404-PGP.html), [BOI-TVA-CHAMP-30-10-20-50](https://bofip.impots.gouv.fr/bofip/943-PGP.html), [BOI-TVA-DECLA-30-20-20-10](https://bofip.impots.gouv.fr/bofip/140-PGP.html)
- [BOI-TPS-TS-20-30](https://bofip.impots.gouv.fr/bofip/6693-PGP.html/identifiant=BOI-TPS-TS-20-30-20220330), [BOI-TPS-TS-30](https://bofip.impots.gouv.fr/bofip/6686-PGP.html/identifiant=BOI-TPS-TS-30-20200624), [BOI-TPS-TS-40](https://bofip.impots.gouv.fr/bofip/6683-PGP.html/identifiant=BOI-TPS-TS-40-20200624)
- Notices [3310-CA3-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5426.pdf), [3517-S-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5424.pdf), [2501-SD 2026](https://www.impots.gouv.fr/sites/default/files/formulaires/2501-sd/2026/2501-sd_5272.pdf), [2501-SD 2025](https://www.impots.gouv.fr/sites/default/files/formulaires/2501-sd/2025/2501-sd_4914.pdf), [2502-SD](https://www.impots.gouv.fr/sites/default/files/formulaires/2502-sd/2025/2502-sd_5241.pdf) ; [impots.gouv.fr, taxe sur les salaires](https://www.impots.gouv.fr/professionnel/questions/comment-declarer-et-payer-ma-taxe-sur-les-salaires-ts)
- Code du travail, [art. L6352-11](https://code.travail.gouv.fr/code-du-travail/l6352-11), [art. R6352-22 à R6352-24](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000018522310), [art. L6351-6](https://code.travail.gouv.fr/code-du-travail/l6351-6) ; [cerfa n° 10443*17](https://www.formulaires.service-public.gouv.fr/gf/cerfa_10443_17.do) et [notice n° 50199#17](https://www.formulaires.service-public.gouv.fr/gf/getNotice.do?cerfaNotice=50199&cerfaFormulaire=10443) ; [Mon Activité Formation](https://www.monactiviteformation.emploi.gouv.fr/mon-activite-formation/) ; [DREETS Bretagne, campagne 2026](https://bretagne.dreets.gouv.fr/Campagne-2026-Depot-de-votre-Bilan-pedagogique-et-financier-BPF)
- [Décret n° 2020-1545 du 9 décembre 2020](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042636412) (DREETS, DRIEETS)
- [PCG, liste des comptes 2025](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/Plan-de-comptes-PCG-2025.pdf) (6311, 447, 44566, 658, 758)
