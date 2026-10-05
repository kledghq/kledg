# Rémunération et dividendes

Le simulateur compare, pour le dirigeant associé d'une société à l'impôt sur
les sociétés, ce qu'il garde du résultat de l'exercice selon qu'il se le verse
en **rémunération**, en **dividendes** ou en **mélange des deux**, et cherche
la répartition qui lui laisse le plus. C'est une **simulation indicative,
jamais un conseil** : les cotisations sont approchées, la situation du foyer
est simplifiée, et le choix se fait avec l'expert-comptable. Chaque écran,
export et réponse de l'outil MCP le rappelle.

Page : États, Rémunération et dividendes (`/<société>/remuneration`, mode
expert). Carte « Combien puis-je me verser ? » sur l'accueil du mode simple.
Code : `lib/remuneration`. Remplace le simulateur de dividendes de l'ancienne
application, réécrit : sa réserve légale et ses tranches d'impôt sur les
sociétés étaient fausses (voir plus bas), son impôt sur le revenu figé.

Règles vérifiées le 5 octobre 2026 sur la loi de finances pour 2026 (loi
n° 2026-103 du 19 février 2026) et la loi de financement de la sécurité
sociale pour 2026 (loi n° 2025-1403 du 30 décembre 2025). Chaque scénario
enregistré garde l'année des règles qui l'ont calculé (`rulesYear`).

## Ce que Kledg lit dans les comptes

| Donnée | D'où elle vient |
| --- | --- |
| Résultat avant rémunération du dirigeant et avant impôt | Compte de résultat de l'exercice (écritures validées, écriture de clôture exclue), comptes 69 réintégrés, plus la rémunération du dirigeant déjà comptabilisée en 644 et 646. Trois bases au choix : l'exercice à ce jour, l'exercice projeté sur l'année (au prorata des jours écoulés), le dernier exercice clos. Par défaut : l'exercice lui-même s'il est terminé, sinon le dernier exercice clos, sinon la projection |
| Statut du dirigeant | Forme juridique : président de SAS, SASU, SA, SELAS assimilé salarié (CSS, art. L311-3) ; gérant de SARL, EURL, SELARL non salarié s'il détient plus de la moitié du capital (avec son conjoint, ses enfants mineurs et les cogérants), assimilé salarié sinon. Les autres formes ne sont pas couvertes |
| Taux réduit de 15 % et son plafond | La feuille d'impôt sur les sociétés de l'exercice ([impôt sur les sociétés](impot-societes.md)) : réponse « oui » aux conditions, plafond de 42 500 € proratisé. Une condition sans réponse simule à 25 % |
| Capital, réserve légale, pertes antérieures | Soldes des comptes 101, 1061 et 119 de l'exercice (comme l'[affectation du résultat](approbation-des-comptes.md)) ; à défaut de 101, le capital des informations de la société |
| Part du capital du dirigeant | L'associé personne physique qui détient le plus de parts ; 100 % s'il n'y en a pas |
| Comptes courants | Solde créditeur des comptes 455, tous associés, en aide pour le seuil des 10 % d'un non salarié |
| Dividendes proposés | L'affectation proposée dans l'approbation des comptes de l'exercice |

Ce qui se saisit : la situation du foyer (parts, autres revenus imposables),
l'imposition des dividendes (prélèvement forfaitaire, barème, ou le plus
favorable), la part du bénéfice distribuable versée, la part du mixte, et pour
un non salarié les primes d'émission et le compte courant moyen. Tout se
modifie sans rien enregistrer ; « Revenir aux chiffres des comptes » annule
les changements. Si la rémunération du dirigeant est comptabilisée en 641 et
645 avec celle des salariés, ajoutez-la au résultat.

## Le calcul d'un scénario

Pour un budget R (le résultat avant rémunération et avant impôt) et une part
C de ce budget consacrée à la rémunération (rémunération et cotisations) :

1. **Rémunération** : les cotisations de l'assimilé salarié ou du non salarié
   (plus bas) ; la société dépense C.
2. **Impôt sur les sociétés** sur R moins C : 15 % jusqu'au plafond si la
   société y a droit, 25 % au-delà (CGI, art. 219, I ; fonctions de
   `lib/corporate-tax/rules.ts`). Pas de contribution sociale de 3,3 %
   (réservée aux sociétés dont l'impôt dépasse 763 000 €).
3. **Réserve légale** : un vingtième du bénéfice après impôt diminué des
   pertes antérieures, jusqu'au dixième du capital (C. com., art. L232-10),
   pour les SARL et sociétés par actions, avec la fonction de l'affectation
   du résultat (`legalReserveFor`). L'ancienne application prenait le plus
   grand de 5 % du capital et 10 % du bénéfice : c'était faux.
4. **Dividendes** : le bénéfice distribuable de l'exercice, bénéfice après
   impôt moins les pertes antérieures et la réserve (L232-11, sans le report à
   nouveau des exercices précédents), multiplié par la part distribuée ; le
   dirigeant reçoit sa part du capital.
5. **Prélèvements sur les dividendes** : prélèvements sociaux de 18,6 %, ou,
   pour un non salarié, cotisations sociales sur la part au-delà du seuil de
   10 % (plus bas).
6. **Impôt sur le revenu** du foyer avec et sans cette rémunération et ces
   dividendes ; la différence est celle du dirigeant.
7. **Net pour le dirigeant** : rémunération nette, plus dividendes reçus,
   moins les prélèvements sur les dividendes et l'impôt sur le revenu.

Les quatre scénarios : tout en rémunération (C = R), tout en dividendes
(C = 0), mixte (C = la part du curseur) et l'**optimum** : Kledg parcourt C
de 0 à R sur une grille de cent pas, puis des grilles plus fines autour du
meilleur point jusqu'à l'euro ; à revenu égal, le coût le plus bas l'emporte
(plus d'argent reste dans la société). L'optimum ne regarde que le revenu du
dirigeant : les dividendes des autres associés sortent aussi de la société,
la page le rappelle.

Chaque scénario donne : coût de la rémunération pour la société, bénéfice et
impôt sur les sociétés, réserve légale, dividendes distribués, reste dans la
société, rémunération brute, cotisations de la société et du dirigeant,
rémunération nette, dividendes reçus, prélèvements sociaux ou cotisations
sur dividendes, impôt sur le revenu, net, total des impôts et cotisations.
La courbe montre le net pour chaque part de 0 à 100 % en rémunération.

## Dividendes

| Règle | Valeur 2026 | Source |
| --- | --- | --- |
| Prélèvement forfaitaire unique, part impôt sur le revenu | 12,8 % | CGI, art. 200 A, 1, A |
| Prélèvements sociaux sur les dividendes versés depuis le 1er janvier 2026 | 18,6 % : CSG 10,6 % (au lieu de 9,2 %), CRDS 0,5 %, prélèvement de solidarité 7,5 % ; d'où un PFU de 31,4 % | CSS, art. L136-8, I, 2° modifié par la LFSS 2026, art. 12 |
| Option pour le barème | Globale et annuelle, pour tous les revenus du foyer entrant dans le champ du PFU | CGI, art. 200 A, 2 |
| Abattement au barème | 40 % | CGI, art. 158, 3, 2° |
| CSG déductible au barème | 6,8 % des dividendes soumis aux prélèvements sociaux, déduite du revenu de l'année de paiement ; la hausse de 1,4 point n'est pas déductible | CGI, art. 154 quinquies, II |
| Non salarié : dividendes soumis aux cotisations | La part qui dépasse 10 % du capital détenu, des primes d'émission et du solde moyen du compte courant (dirigeant, conjoint, enfants mineurs) : cotisations des indépendants au lieu des prélèvements sociaux ; elle reste un dividende pour l'impôt sur le revenu | CSS, art. L131-6 |

« Le plus favorable » calcule chaque scénario avec les deux impositions et
garde la plus basse ; le tableau indique laquelle, et l'autre montant.

## Cotisations

Plafond annuel de la sécurité sociale 2026 : **48 060 €** (arrêté du
22 décembre 2025). T1 : jusqu'à un plafond ; T2 : d'un à huit plafonds.

### Assimilé salarié (approximation)

Cadre, aux taux pleins (un mandataire sans contrat de travail ne bénéficie
pas de la réduction générale), sans assurance chômage ni AGS (il n'y est pas
assujetti) :

| Cotisation | Société | Dirigeant | Base |
| --- | --- | --- | --- |
| Maladie | 13 % | | Totalité |
| Vieillesse plafonnée | 8,55 % | 6,90 % | T1 |
| Vieillesse déplafonnée | 2,11 % | 0,40 % | Totalité |
| Allocations familiales | 5,25 % | | Totalité |
| Contribution solidarité autonomie | 0,30 % | | Totalité |
| FNAL (moins de 50 salariés) | 0,10 % | | T1 |
| Accidents du travail | 0,75 % (indicatif, le taux réel est notifié à la société) | | Totalité |
| Agirc-Arrco | 4,72 % T1, 12,95 % T2 | 3,15 % T1, 8,64 % T2 | |
| Contribution d'équilibre général | 1,29 % T1, 1,62 % T2 | 0,86 % T1, 1,08 % T2 | |
| Contribution d'équilibre technique | 0,21 % | 0,14 % | Totalité jusqu'à 8 plafonds, au-delà d'un plafond |
| APEC | 0,036 % (arrondi à 0,04 %) | 0,024 % (arrondi à 0,02 %) | Jusqu'à 4 plafonds |
| Prévoyance des cadres | 1,50 % | | T1 |
| Formation professionnelle (moins de 11 salariés), taxe d'apprentissage | 0,55 %, 0,68 % | | Totalité |
| CSG déductible, CSG non déductible et CRDS | | 6,8 %, 2,9 % | 98,25 % du brut jusqu'à 4 plafonds |

La société dépense le brut et ses cotisations ; Kledg cherche le plus grand
brut dont le coût tient dans le budget. Le revenu imposable est le net plus la
CSG non déductible et la CRDS. Vers un plafond, la société paie environ 39 %
du brut en plus et le dirigeant environ 21 % du brut : un coût d'environ
175 % du net. Sources : taux de cotisations du secteur privé de l'URSSAF,
Agirc-Arrco 2026, BOSS (assiette de la CSG).

### Non salarié (approximation)

Assiette unique de la réforme des indépendants (LFSS 2024, art. 18 ; décret
n° 2024-688 du 5 juillet 2024), appliquée aux revenus depuis 2025 : le revenu
avant cotisations, ici tout ce que la société dépense pour le gérant
(rémunération et cotisations qu'elle paie pour lui), moins un abattement de
26 % (au moins 1,76 % et au plus 130 % du plafond). Une seule base pour
toutes les cotisations et la CSG-CRDS :

| Cotisation | Taux |
| --- | --- |
| Maladie-maternité (CSS, art. D621-1) | 8,5 % jusqu'à 3 plafonds et 6,5 % au-delà ; réduit sous 3 plafonds : 0 % sous 20 % du plafond, puis 1,5 % à 40 %, 4 % à 60 %, 6,5 % à 110 %, 7,7 % à 200 %, 8,5 % à 300 %, en ligne droite entre ces points, appliqué à toute l'assiette |
| Indemnités journalières | 0,5 % jusqu'à 5 plafonds, assiette minimale de 40 % du plafond |
| Retraite de base (CSS, art. D633-3) | 17,15 % jusqu'à un plafond et 0,72 % sur toute l'assiette, assiette minimale de 11,5 % du plafond |
| Retraite complémentaire | 8,1 % jusqu'à un plafond, 9,1 % d'un à quatre plafonds |
| Invalidité-décès | 1,3 % jusqu'à un plafond, assiette minimale de 11,5 % du plafond |
| Allocations familiales | 0 % jusqu'à 110 % du plafond, puis jusqu'à 3,1 % à 140 %, appliqué à toute l'assiette |
| CSG-CRDS | 9,7 %, dont 6,8 % déductible |
| Formation professionnelle | 0,25 % du plafond (commerçant) |

La rémunération nette est le budget moins les cotisations ; sous les
cotisations minimales, elle est négative (le gérant les doit même sans
rémunération). Le revenu imposable (CGI, art. 62) est la rémunération plus la
CSG non déductible et la CRDS. Les cotisations sur la part des dividendes
au-delà du seuil sont la différence entre les cotisations avec et sans cette
part. Kledg simule l'année régularisée, pas les acomptes provisionnels.
Sources : CSS, livre VI ; décret n° 2024-688 ; page de la réforme sur
urssaf.fr.

## Impôt sur le revenu

Le barème des revenus de 2026 viendra avec la loi de finances pour 2027 :
Kledg utilise le dernier voté, celui des revenus de 2025 (LFI 2026, art. 4,
indexé de 0,9 %), et la page le dit.

| Tranche par part | Taux |
| --- | --- |
| Jusqu'à 11 600 € | 0 % |
| De 11 600 € à 29 579 € | 11 % |
| De 29 579 € à 84 577 € | 30 % |
| De 84 577 € à 181 917 € | 41 % |
| Au-delà de 181 917 € | 45 % |

- Quotient familial (CGI, art. 197, I, 2) : l'avantage de chaque demi-part
  au-delà d'une part (personne seule) ou de deux (couple) est plafonné à
  1 807 €. Le plafond particulier d'un parent isolé n'est pas simulé.
- Décote (CGI, art. 197, I, 4) : 897 € (1 483 € pour un couple) moins
  45,25 % de l'impôt.
- Déduction de 10 % pour frais professionnels sur les salaires et la
  rémunération d'un gérant majoritaire (CGI, art. 83, 3° et 62), entre 509 €
  et 14 555 € (BOI-BAREME-000035).
- Le revenu est arrondi à l'euro inférieur avant le barème.

## Impôt sur les sociétés

15 % jusqu'à 42 500 € de bénéfice (proratisé pour un exercice qui ne dure pas
douze mois), 25 % au-delà (CGI, art. 219, I) : inchangé par la LFI 2026.
L'ancienne application gardait les tranches 2018 à 2021 (38 120 €, 28 %,
31 %) ; Kledg reprend les fonctions du module de l'impôt sur les sociétés.
Les déficits reportables ne sont pas imputés dans la simulation.

## Ce qui n'est pas simulé

- Contribution exceptionnelle sur les hauts revenus (au-delà de 250 000 € de
  revenu fiscal de référence, 500 000 € pour un couple) et contribution
  différentielle : la page le signale quand les revenus approchent ce seuil.
- Réductions et crédits d'impôt, pensions alimentaires, autres revenus de
  capitaux du foyer (l'option pour le barème vaut pour tous).
- Mutuelle, avantages en nature, frais professionnels réels, épargne
  salariale, retraite supplémentaire, exonérations de début d'activité (ACRE).
- Droits sociaux : un assimilé salarié sans rémunération ne valide pas de
  trimestres de retraite ; la page le rappelle.
- Report à nouveau des exercices antérieurs, réserves statutaires,
  acomptes sur dividendes, régime mère-fille d'une holding associée.

Pour un calcul détaillé : le simulateur officiel de l'URSSAF
(mon-entreprise.urssaf.fr).

## Scénarios enregistrés et approbation des comptes

Un scénario garde un nom, ses hypothèses (`RemunerationInputsSchema`),
l'année des règles et ses chiffres (coût de la rémunération, dividendes, net)
pour l'exercice. Enregistrer un nom qui existe le remplace. « Proposer à
l'approbation » reporte ses dividendes dans l'affectation proposée de
l'[approbation des comptes](approbation-des-comptes.md) de l'exercice, par le
service de l'approbation : le reste de l'approbation ne change pas, les
associés votent, puis l'affectation du résultat comptabilise les dividendes
(457). Un scénario dont les hypothèses ne se lisent plus avec les règles
actuelles doit être simulé de nouveau avant d'être proposé.

Table `remuneration_scenarios` (migration
`20261107090000_remuneration_scenarios`) : une ligne par nom et exercice
(clé unique exercice, société, nom ; clé étrangère composite vers l'exercice
de la même société). Contraintes de la base : nom de 1 à 80 caractères,
coût et dividendes jamais négatifs, hypothèses en objet JSON. Sécurité au
niveau des lignes : table de société, politiques `kledg_rls_*` sur
`companyId` ([rls.md](rls.md)).

## Exports

PDF et CSV (séparateur « ; », virgule décimale, BOM UTF-8, cellules
protégées contre les formules), droit `reports:export`, limite `export` :
mêmes hypothèses, scénarios, lignes, remarques et sources que la page, avec
l'avertissement.

## Mode simple

L'accueil du mode simple affiche « Combien puis-je me verser ? » : avec le
bénéfice prévu avant rémunération, ce que le dirigeant garderait à
l'optimum, et comment (un salaire qui coûte tant à la société, puis tant de
dividendes), avec « Estimation indicative, pas un conseil » et un lien vers
le détail. Mêmes chiffres que la page experte (même route, même calcul).
Rien pour une société à l'impôt sur le revenu ou d'une forme non couverte
([mode simple](mode-simple.md)).

## API et MCP

| Route | Droit | Effet |
| --- | --- | --- |
| `GET /api/companies/[id]/remuneration?fiscalYearId=&scenarioId=&basis=&inputs=` | `reports:read` | Les chiffres des comptes, les hypothèses (celles par défaut, d'un scénario, puis les changements en JSON), la simulation, les scénarios enregistrés, les dividendes proposés |
| `GET /api/companies/[id]/remuneration/export?...&format=pdf\|csv` | `reports:export` | La simulation en fichier |
| `PUT /api/companies/[id]/remuneration/scenarios { fiscalYearId, name, inputs, pick }` | `closing:execute` | Enregistre ou remplace un scénario |
| `DELETE /api/companies/[id]/remuneration/scenarios?scenarioId=` | `closing:execute` | Supprime un scénario |
| `POST /api/companies/[id]/remuneration/propose-dividends { scenarioId }` | `closing:execute` | Propose ses dividendes dans l'approbation des comptes |

Outils MCP ([mcp.md](mcp.md)) : `simulate_remuneration` (lecture, montants en
euros, parts en pourcentage, avec l'avertissement) et
`save_remuneration_scenario` (brouillons, `kledg:write` : enregistrer,
supprimer, proposer les dividendes). Aucun ne conseille, ne vote ni ne
comptabilise.

## Tests

- `lib/remuneration/__tests__/simulate.test.ts` : barème, décote, plafond du
  quotient familial, déduction de 10 % ; cotisations d'un assimilé salarié
  (40 000 € et 100 000 € bruts) et d'un non salarié (budget de 50 000 €,
  minimum sans rémunération, maladie au-delà de 3 plafonds) ; exemples
  chiffrés d'une SASU et d'une EURL ; dividendes au-delà de 10 % du capital ;
  PFU contre barème ; seuils de l'impôt sur les sociétés ; réserve légale ;
  optimum au moins égal à chaque scénario et croissant avec le résultat ;
  formulation du mode simple sans jargon.
- `lib/remuneration/__tests__/remuneration.db.test.ts` (PostgreSQL, aussi
  avec `KLEDG_RLS=enforce`) : préremplissage depuis les comptes, gérant
  majoritaire, SCI, routes pour chaque rôle, scénarios enregistrés, remplacés
  et supprimés, dividendes proposés à l'approbation, exports, contraintes.
- `lib/mcp/__tests__/remuneration-tools.test.ts`, la matrice des
  autorisations, l'isolation des sociétés (`lib/rls/__tests__`), la
  couverture des routes par le serveur MCP.

## Sources

- [Loi n° 2026-103 du 19 février 2026 de finances pour 2026](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053508155) (art. 4 : barème)
- [Loi n° 2025-1403 du 30 décembre 2025 de financement de la sécurité sociale pour 2026, art. 12](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053226452) (CSG de 10,6 % sur les revenus de capitaux)
- [CGI](https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577) : art. 62, 83, 154 quinquies, 158, 197, 200 A ; [art. 219](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046868562)
- [Barème de l'impôt sur le revenu](https://www.service-public.gouv.fr/particuliers/vosdroits/F1419) et [BOI-BAREME-000035](https://bofip.impots.gouv.fr/bofip/10855-PGP.html/identifiant=BOI-BAREME-000035-20260217) (déduction de 10 %)
- [Code de commerce](https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005634379) : art. L232-10, L232-11
- [Code de la sécurité sociale](https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006073189) : art. L131-6, L136-8, L311-3, D621-1, D633-3
- [Décret n° 2024-688 du 5 juillet 2024](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049888566) (assiette unique des indépendants)
- [Arrêté du 22 décembre 2025](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053143451) (plafond de la sécurité sociale 2026)
- URSSAF : [taux du secteur privé](https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/taux-cotisations-secteur-prive.html), [réforme des indépendants](https://www.urssaf.fr/accueil/independant/comprendre-payer-cotisations/reforme-cotisations-independants.html) ; [Agirc-Arrco](https://www.agirc-arrco.fr) ; [BOSS](https://boss.gouv.fr)
