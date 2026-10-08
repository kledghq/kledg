# Notes de frais

Les dépenses qu'un salarié, un dirigeant ou un associé avance pour la société, et ses trajets avec un véhicule personnel : saisie avec les justificatifs, TVA récupérable calculée ligne par ligne, indemnités kilométriques au barème officiel, validation, comptabilisation au crédit du compte de la personne et remboursement constaté par le lettrage. Code : `lib/expense-reports`, pages `/expense-reports`, outils MCP `list_expense_reports`, `get_expense_report`, `list_expense_claimants` et, avec l'accès brouillons, `create_draft_expense_report`.

## Bénéficiaires

Page **Notes de frais, Bénéficiaires et catégories** (`/expense-reports/settings`), API `GET|POST /api/expense-claimants`, `PATCH|DELETE /api/expense-claimants/[id]`, `GET /api/expense-claimants/options`.

Un bénéficiaire est une personne que la société rembourse, liée à une personne de la société (ou à un associé personne physique) ou à un membre. Sa qualité donne le compte crédité par ses notes (PCG art. 932-1, liste des comptes) :

| Qualité | Compte par défaut | Pourquoi |
| --- | --- | --- |
| Salarié | 421 « Personnel, rémunérations dues » | Ce que la société doit à son personnel |
| Associé (dirigeant ou non) | 455 « Associés, comptes courants » | La somme avancée reste due à l'associé sur son compte courant |
| Dirigeant ni salarié ni associé | 467 « Autres comptes débiteurs ou créditeurs » | Un président de SAS sans rémunération ni actions, un gérant non associé |

- Le compte se choisit par bénéficiaire : un dirigeant assimilé salarié se règle sur 421, un dirigeant associé sur 455, et un sous-compte (4551, 467100...) est accepté. Seuls les comptes 421, 425, 455 et 467 et leurs sous-comptes sont admis, car ce sont des comptes lettrables (contrainte de la base).
- **Compte auxiliaire** (FEC `CompAuxNum`) unique dans la société : S00001 pour les salariés, D00001 pour les dirigeants, A00001 pour les associés. Il est porté par la ligne créditée, si bien que le lettrage et les balances distinguent chaque personne sur un même compte 421. Il ne change plus dès qu'une note du bénéficiaire est comptabilisée.
- Un membre qui dépose sa première note devient bénéficiaire « salarié » à son nom ; un administrateur ou le comptable corrige ensuite sa qualité et son compte.
- Un bénéficiaire qui a des notes ne se supprime pas.

## Notes de frais

Pages **Notes de frais** (`/expense-reports`, toutes les notes pour qui valide) et **Mes notes de frais** (`/expense-reports/mine`), fiche d'une note (`/expense-reports/[id]`). API `GET|POST /api/expense-reports`, `GET|PATCH|DELETE /api/expense-reports/[id]`, `POST /api/expense-reports/[id]/workflow`.

- **Une note** : un bénéficiaire, une période, un numéro NDF-0001, NDF-0002... unique dans la société, des lignes. Chaque ligne est datée dans la période.
- **Dépense** : date, fournisseur, libellé, catégorie, compte (celui de la catégorie s'il est vide), montant payé TTC, taux de TVA et TVA du justificatif (calculée depuis le montant si elle est vide ; un écart de plus de 2 centimes avec le taux est refusé), justificatif (facture au nom de la société, ticket, aucun). Un ticket à deux taux se saisit sur deux lignes. Seuls les taux français sont acceptés : une TVA payée à l'étranger ne se déduit pas en France, la dépense se saisit à 0 % et reste en charge.
- **Trajet** : date, trajet et motif, distance en kilomètres entiers, véhicule (voiture, moto, cyclomoteur), puissance fiscale, électrique ou non. Voir Indemnités kilométriques.
- Les montants sont recalculés par le serveur à chaque enregistrement, en centimes (`lib/expense-reports/amounts.ts`, le même module dans l'éditeur) : un total envoyé par un client est ignoré.

### Catégories et comptes

| Catégorie | Compte | TVA |
| --- | --- | --- |
| Transport (train, avion, taxi, VTC) | 6251 Voyages et déplacements | Jamais récupérable |
| Péages et parking | 6251 Voyages et déplacements | Récupérable avec le reçu au nom de la société (BOI-TVA-DED-40-40, § 30 et § 330) |
| Hébergement (hôtel) | 6256 Missions | Jamais récupérable |
| Repas en déplacement | 6256 Missions | Récupérable |
| Repas d'affaires et réceptions | 6257 Réceptions | Récupérable |
| Carburant (véhicule de tourisme) | 6061 Fournitures non stockables | 80 % |
| Petites fournitures | 6064 Fournitures administratives | Récupérable |
| Frais postaux et télécommunications | 626 | Récupérable |
| Cadeaux à la clientèle | 6234 | Jusqu'à 73 € TTC |
| Indemnités kilométriques | 6251 Voyages et déplacements | Sans TVA |
| Autre dépense | à choisir (classe 6) | Récupérable |

### TVA récupérable

Règles appliquées dans cet ordre, la première qui s'applique décide (`lib/expense-reports/vat-recovery.ts`) :

1. Pas de TVA sur le justificatif, ou une indemnité kilométrique : rien à récupérer.
2. Société en franchise en base (CGI art. 293 B) : aucune TVA récupérée.
3. **Justificatif.** La TVA se déduit sur une facture établie au nom de la société (CGI art. 271, II, 1, a ; mentions de l'art. 242 nonies A de l'annexe II). Tolérance : un ticket détaillé, qui indique le taux et le montant de la TVA, d'au plus 150 € HT, sur lequel la société ajoute son nom et son adresse (BOI-TVA-DECLA-30-20-20-20, § 130 à 150). Sans justificatif, ou un ticket au-delà de 150 € HT : rien.
4. **Exclusions** de l'article 206, IV, 2 de l'annexe II du CGI (version en vigueur depuis le 8 juillet 2024), dont le coefficient d'admission est nul :
   - 2° : la fourniture à titre gratuit du logement des dirigeants ou du personnel, donc l'hôtel d'un déplacement (BOI-TVA-DED-30-30-10) ;
   - 5° : les transports de personnes et leurs opérations accessoires (BOI-TVA-DED-30-30-30) ;
   - 3° : les biens cédés sans rémunération, sauf ceux de très faible valeur, 73 € TTC par bénéficiaire et par an (CGI ann. IV art. 28-00 A). Kledg vérifie la ligne : saisissez une ligne par bénéficiaire.

   Dans le texte en vigueur, le 4° (publicité pour les boissons alcooliques) est abrogé : les exclusions utiles aux notes de frais sont les 2°, 3° et 5°.
5. **Carburant** d'un véhicule de tourisme : 80 % de la TVA sur l'essence et le gazole (CGI art. 298, 4, 1°, a ; BOI-TVA-DED-30-30-40), arrondi au centime. Un véhicule utilitaire ouvre droit à 100 % : choisissez une autre catégorie.
6. Sinon, toute la TVA du justificatif.

Puis, pour une société partiellement exonérée (déduction par coefficient, [organisme de formation](organisme-de-formation.md)), la TVA récupérable de la ligne est multipliée par le coefficient de déduction provisoire du jour de la dépense (CGI ann. II art. 205 et 206), arrondie au centime le plus proche, comme pour les factures d'achat, le mode simple et les règles d'affectation. Une société exonérée dont la déduction se fait par coefficient applique ce coefficient ; seule la franchise en base ne récupère rien.

La TVA non récupérée fait partie de la charge de la ligne. L'éditeur affiche la règle appliquée sous chaque ligne (il prévisualise avec le coefficient de l'année ; l'enregistrement retient celui du jour de chaque ligne).

### Repas de l'exploitant (société à l'impôt sur le revenu)

Quand le bénéfice est imposé à l'impôt sur le revenu de l'exploitant ou des associés (BIC ou BNC), le repas qu'un exploitant ou un associé prend **seul** parce que la distance l'empêche de déjeuner chez lui n'est déductible que pour ses **frais supplémentaires** : la part au-delà de la valeur d'un repas pris au domicile, et jusqu'à la limite au-delà de laquelle la dépense est excessive (BOI-BNC-BASE-40-60-60, § 60 à 170 ; étendu aux BIC par les actualités ACTU-2025-00025 et ACTU-2026-00008). La part jusqu'à la valeur du repas au domicile est une dépense personnelle, la part au-delà de la limite aussi (§ 160), sauf circonstances exceptionnelles (§ 150) que le comptable apprécie.

Seuils TTC par année civile du repas (`MEAL_THRESHOLDS`, `lib/expense-reports/exploitant-meals.ts`) :

| Année | Repas au domicile (§ 130) | Limite (§ 140) | Déductible au plus par repas | Source |
| --- | --- | --- | --- | --- |
| 2022 | 5,00 € | 19,40 € | 14,40 € | [BOI-BNC-BASE-40-60-60 du 09/02/2022](https://bofip.impots.gouv.fr/bofip/4628-PGP.html/identifiant=BOI-BNC-BASE-40-60-60-20220209) |
| 2023 | 5,20 € | 20,20 € | 15,00 € | [BOI-BNC-BASE-40-60-60 du 25/01/2023](https://bofip.impots.gouv.fr/bofip/4628-PGP.html/identifiant=BOI-BNC-BASE-40-60-60-20230125) |
| 2024 | 5,35 € | 20,70 € | 15,35 € | [BOI-BNC-BASE-40-60-60 du 17/01/2024](https://bofip.impots.gouv.fr/bofip/4628-PGP.html/identifiant=BOI-BNC-BASE-40-60-60-20240117) |
| 2025 | 5,45 € | 21,10 € | 15,65 € | [BOI-BNC-BASE-40-60-60 du 19/02/2025](https://bofip.impots.gouv.fr/bofip/4628-PGP.html/identifiant=BOI-BNC-BASE-40-60-60-20250219), [ACTU-2025-00025](https://bofip.impots.gouv.fr/bofip/14587-PGP.html/ACTU-2025-00025) |
| 2026 | 5,50 € | 21,40 € | 15,90 € | [BOI-BNC-BASE-40-60-60 du 18/02/2026](https://bofip.impots.gouv.fr/bofip/4628-PGP.html/identifiant=BOI-BNC-BASE-40-60-60-20260218), [ACTU-2026-00008](https://bofip.impots.gouv.fr/bofip/14932-PGP.html/ACTU-2026-00008) |

Une année sans valeurs connues de Kledg prend les dernières connues (les premières pour une année antérieure à 2022), et l'explication le signale. Chaque année, ajoutez la ligne de l'année avec sa source et un test.

**Calcul**, par repas : part déductible TTC = min(max(TTC - repas au domicile, 0), limite - repas au domicile), le reste n'est pas déductible. Exemple du § 170 en 2026 : 25 € donnent 15,90 € déductibles et 9,10 € non déductibles. La TVA ne change pas (règles de la section TVA récupérable). Quand la TVA est récupérée, la charge est le TTC moins cette TVA, et la part non déductible de la charge est la même proportion du montant payé, arrondie au centime le plus proche : 25 € à 10 % (charge 22,73 €) donnent 14,46 € sur 6256 et 8,27 € sur 62568. Sans TVA récupérée, le partage est exactement celui du BOFiP.

**Comptes** : la part déductible reste sur le compte de la ligne (6256 Missions), la part non déductible va au compte **62568 « Repas de l'exploitant, part non déductible »**, sous-compte de 6256 créé dans le plan de l'exercice s'il manque (complété de zéros à la longueur du compte de la ligne, 625680 pour un plan à six chiffres ; un compte déjà présent sous 62568 est repris). Son solde est la somme à **réintégrer** sur la déclaration de résultat : ligne **316** « Rémunérations et avantages personnels non déductibles » du tableau 2033-B-SD (régime simplifié, notice 2033-NOT-SD 2026 : « dépenses personnelles ... comptabilisées en charges ») ou ligne **WD** « Avantages personnels non déductibles » du 2058-A-SD (régime normal), liasse jointe à la 2031-SD. Kledg ne prépare pas la 2031-SD : le comptable reporte le solde de 62568.

**Qui est concerné** :

- **La société** : son imposition des bénéfices au jour du repas (`lib/companies/profit-taxation.ts`). Kledg lit d'abord le régime d'imposition des bénéfices des régimes fiscaux (Informations, Régimes fiscaux, type « Impôt sur les sociétés » : régime normal ou simplifié pour l'IS, micro-société, ou **Impôt sur le revenu (pas d'IS)**, valeur `income_tax`), à défaut le champ de la société, puis la forme juridique : EI, SNC, SCS et SCI à l'impôt sur le revenu (CGI art. 8) ; EURL et SELARL dont l'associé unique est une personne physique à l'impôt sur le revenu (CGI art. 8, 4°), une personne morale à l'IS ; SARL, SAS, SASU, SA, SELAS et SCA à l'IS (CGI art. 206, 1). Une SARL de famille (CGI art. 239 bis AA) ou une option temporaire (art. 239 bis AB) s'enregistre en « Impôt sur le revenu » dans les régimes fiscaux. Une EURL sans associé enregistré, ou une société sans forme ni régime, est **inconnue** : rien n'est partagé et l'éditeur, la fiche et l'outil MCP disent de renseigner le régime. Une société à l'IS ou au régime micro (charges réelles non déduites) n'est pas concernée.
- **Le bénéficiaire** : un associé (genre Associé, ou une personne liée qui figure parmi les associés personnes physiques), ou le dirigeant d'un entrepreneur individuel, est l'exploitant ; un salarié lié à une personne ou un dirigeant non associé suit les règles des salariés (repas entièrement déductible). Le bénéficiaire créé automatiquement à la première note d'un membre (salarié par défaut, sans personne liée) ne dit rien : chaque repas en déplacement demande alors **« Qui a pris ce repas ? »** (l'exploitant ou un associé, ou un salarié), réponse enregistrée sur la ligne (`expense_lines.mealTaker`, migration `20261119090000_expense_meal_taker`). Comptabiliser une note dont un repas n'a pas de réponse est refusé avec le numéro de la ligne.
- **La dépense** : la catégorie Repas en déplacement seulement. Les repas d'affaires (6257) et les autres catégories ne changent pas.

L'éditeur affiche sous chaque repas la part déductible, la part non déductible, les seuils de l'année et le lien vers la source (`GET /api/expense-reports/meal-rule?companyId=&claimantId=&day=`, droit `expenses:submit`, un membre qui ne valide pas ne lit que son propre bénéficiaire) ; la fiche de la note (`GET /api/expense-reports/[id]`, champs `lines[].meal` et `mealRule`) et la comptabilisation recalculent tout sur le serveur, à la date de chaque repas.

### Indemnités kilométriques

Barème forfaitaire fixé par arrêté, appliqué par l'URSSAF (une indemnité dans la limite du barème est exonérée de cotisations) et versionné par année dans `lib/expense-reports/mileage-scale.ts` :

| Années | Source |
| --- | --- |
| 2022 à 2026 | Arrêté du 27 mars 2023 (JORF du 7 avril 2023), BOI-BAREME-000001-20230720 ; barème reconduit à l'identique pour 2024, 2025 et 2026 (URSSAF, Indemnités kilométriques) |

- Voitures de 3 CV et moins à 7 CV et plus (tranches jusqu'à 5 000 km, de 5 001 à 20 000 km, au-delà), motos (1 ou 2 CV, 3 à 5 CV, plus de 5 CV) et cyclomoteurs (tranches jusqu'à 3 000 km, de 3 001 à 6 000 km, au-delà).
- Véhicule électrique : majoration de 20 % (BOI-BAREME-000001).
- **Tranches annuelles** : la distance du barème est celle de l'année avec ce véhicule. Un trajet est payé la différence entre le barème au kilométrage cumulé après lui et avant lui ; le cumul compte les trajets des autres notes du bénéficiaire déjà soumises ou validées dans l'année, puis les trajets plus anciens de la note. Les trajets d'une année font ainsi exactement le barème de la distance de l'année, dans n'importe quel ordre.
- Une année absente du tableau est refusée : Kledg ne devine jamais un barème. Ajoutez l'année et sa source à la publication de l'arrêté.
- Pas de TVA ; compte 6251.

### Justificatifs

Kledg ne stocke aucun fichier (il n'a pas de stockage de fichiers, comme pour les factures). Une ligne garde :

- la **référence d'une pièce déjà connue de Kledg** : un justificatif Qonto synchronisé avec les transactions bancaires (`GET /api/expense-reports/receipts`, droit `banking:read`). La pièce doit appartenir à la société ; elle s'affiche depuis la fiche par le proxy des justificatifs bancaires, qui demande un lien frais à Qonto (hôtes de fichiers Qonto seulement, en https, sans redirection, avec un délai et une taille maximale) ;
- ou la **référence d'un justificatif conservé** par la société (papier, courriel), en texte libre. Les pièces justificatives se conservent dix ans (Code de commerce art. L123-22).

## Rôles et cycle de vie

Droit `expenses` (`lib/permissions.ts`) : `submit` pour tous les rôles, `validate` pour l'administrateur de la société et le comptable.

| Statut | Comment | Qui |
| --- | --- | --- |
| Brouillon | Créée, ou renvoyée par un valideur avec une explication | L'auteur la modifie, la supprime, la soumet |
| Soumise | Envoyée pour validation | Un valideur la modifie, la renvoie, la valide |
| Validée | Prête à comptabiliser ; un valideur peut la rouvrir tant qu'elle n'est pas comptabilisée | Droit `entries:create` pour comptabiliser |
| Comptabilisée | Son écriture existe (déduit de l'écriture) | Droit `entries:delete` pour supprimer l'écriture en brouillon |
| Remboursée | La ligne du bénéficiaire est lettrée (déduit du lettrage) | Droit `entries:update` pour lettrer |

- Un membre en lecture seule dépose ses propres notes : il ne voit que les siennes (« introuvable » pour celles des autres, sur les pages, l'API et le MCP). Un valideur voit toutes les notes de la société.
- Valider demande un compte pour chaque ligne (la catégorie « Autre dépense » n'en a pas par défaut).
- Séparation des tâches : l'auteur d'une note (l'utilisateur lié à son bénéficiaire) ne la valide pas tant qu'un autre membre de la société a le droit `expenses:validate` (administrateur ou comptable, compte non bloqué) : c'est lui qui la valide, sinon la validation est refusée (409). Seul valideur de la société (société d'une personne), l'auteur peut la valider, mais c'est enregistré : colonne `expense_reports.selfValidated`, champ `selfValidated` de la fiche (`GET /api/expense-reports/[id]`, `get_expense_report`), mention sur la fiche et `selfValidated: true` dans l'entrée `VALIDATE_EXPENSE_REPORT` du journal d'audit. La fiche d'une note soumise de son propre auteur valideur donne `ownValidation` (`refused` ou `sole-validator`). La règle est dans le service du workflow (`lib/expense-reports/self-validation.ts`) : page, API et outil MCP `manage_expense_report` la suivent. Rouvrir la note efface la mention.

## Comptabilisation

Bouton **Comptabiliser**, `POST /api/expense-reports/[id]/post` ; `DELETE` supprime l'écriture tant qu'elle est en brouillon.

Une écriture en brouillon, par le chemin unique de création des écritures (`createEntryInTx` : équilibre au centime, journal et comptes de la société, exercice ouvert contenant la date), datée du dernier jour de la période (le jour où la société doit la somme), au journal **NDF** si la société en a un, sinon au journal **OD** :

| Compte | Débit | Crédit |
| --- | --- | --- |
| Compte de charge de chaque ligne | TTC moins la TVA récupérable | |
| 62568 Repas de l'exploitant, part non déductible (société à l'impôt sur le revenu) | part non déductible d'un repas seul de l'exploitant | |
| 44566 TVA sur autres biens et services, par taux | TVA récupérable | |
| Compte du bénéficiaire (421, 455, 467 ou le sien), avec son compte auxiliaire | | Total à rembourser |

- **Exercice** : celui qui contient la fin de la période, et lui seul. Chaque ligne doit être datée dans cet exercice (une charge appartient à l'exercice où elle est engagée) : une note à cheval sur deux exercices se scinde. Aucun exercice : refus (400) ; exercice clôturé : refus (409).
- **Comptes** : cherchés dans le plan de comptes de cet exercice et de cette société (`lib/invoices/ledger-accounts.ts`) ; un code saisi doit exister tel quel, un compte par défaut est trouvé par sa racine (6251, puis 625100, puis le premier sous-compte). Un compte absent : refus avec le compte à créer.
- Une note se comptabilise une fois (verrou sur la ligne de la note). Une écriture validée se corrige par contre-passation (PCG art. 1031-3).

## Remboursement

Bloc **Remboursement** de la fiche, `GET|POST /api/expense-reports/[id]/reimbursement`.

- Le remboursement vient de la banque : la ligne d'une écriture **validée** et **rapprochée** avec une transaction bancaire, au débit du compte du bénéficiaire, sans compte auxiliaire ou avec le sien, non lettrée. Kledg propose ces lignes, les montants exacts en premier.
- Les lignes choisies doivent faire exactement le montant de la note (un ou plusieurs virements) : Kledg n'a pas de lettrage partiel ([lettrage et tiers](lettrage-et-tiers.md#lettrage)). Le service de lettrage lettre la ligne du bénéficiaire avec elles (écritures validées, même exercice, groupe équilibré, verrou par compte), et la note devient **remboursée**.
- Le statut se déduit du lettrage : lettrer les lignes à la main dans Lettrage rembourse aussi la note, et les délettrer la ramène à comptabilisée. Un remboursement sur l'exercice suivant se lettre avec les à-nouveaux dans Lettrage.

## Catégories automatiques

`GET|POST /api/expense-category-rules`, `PATCH|DELETE /api/expense-category-rules/[id]`. Un mot-clé trouvé dans le fournisseur ou le libellé, sans tenir compte des majuscules ni des accents, propose la catégorie (et le compte s'il est donné) : « sncf » pour Transport par exemple. La plus forte priorité l'emporte, puis le mot-clé le plus long. L'éditeur applique la règle quand la ligne est encore en « Autre dépense » ; le serveur l'applique à une ligne reçue sans catégorie (outil MCP). Les règles d'affectation des transactions (`lib/transactions`) servent un autre besoin (plusieurs champs bancaires, écriture complète) : une simple table de mots-clés par société suffit et reste prévisible. Aucun mot-clé n'est compilé en expression régulière.

## Import Qonto : non disponible

Vérifié le 4 octobre 2026 dans la référence publique de l'API Business de Qonto (docs.qonto.com, index `llms.txt` et page des portées OAuth) : **aucun point d'accès ne publie les notes de frais ni les remboursements de dépenses.**

- Les seules « requests » publiques sont `GET /v2/requests` (portée `organization.read`), dont le filtre `request_type` n'accepte que `transfer`, `multi_transfer`, `flash_card` et `virtual_card`, et leurs créations et décisions.
- Aucune portée OAuth ne couvre les notes de frais ; les pages `/expense-reports` ou `/reimbursements` de la référence n'existent pas.
- Le point d'accès `/expense_reports` n'y figure pas : Kledg ne l'appelle pas.

Un remboursement payé par Qonto arrive comme une transaction bancaire : rapprochez-la avec le compte du bénéficiaire, puis lettrez la note avec elle (Remboursement). Si Qonto publie un jour un point d'accès, l'import se fera en lecture seule, sans doublon par identifiant Qonto.

## MCP

- `list_expense_reports`, `get_expense_report` : lecture, droit `entries:read` dans la société et la société autorisée pour la connexion, puis les notes que le rôle de l'utilisateur lui montre.
- `list_expense_claimants` : les bénéficiaires (identifiant, compte auxiliaire) que le rôle de l'utilisateur lui montre, droit `entries:read`.
- `create_draft_expense_report` (lecture et brouillons, `kledg:write`, droit `expenses:submit` comme `POST /api/expense-reports`) : crée une note en brouillon à partir de justificatifs (dépenses avec montant payé en euros, taux, TVA et éventuellement l'identifiant d'une pièce Qonto de la société) et de trajets, pour l'utilisateur ou, s'il valide les notes, pour un autre bénéficiaire. `dryRun: true` montre les totaux et la TVA récupérée par ligne sans rien enregistrer. Pour une société à l'impôt sur le revenu, chaque repas en déplacement porte `meal` (parts déductible et non déductible, seuils de l'année, source ; `status: ask` quand il faut préciser `mealTaker`, EXPLOITANT ou EMPLOYEE) ; `get_expense_report` donne le même `meal` par ligne et `mealRule`. La note reste un brouillon : la personne la soumet, un valideur la valide et la comptabilise dans Kledg. La réponse donne le lien `reviewUrl` vers la note. Cet outil demandait auparavant le contrôle total.

## Limites

- Kledg ne stocke pas les fichiers des justificatifs (voir Justificatifs).
- Pas de note en devise : une dépense à l'étranger se saisit pour le montant débité en euros, à 0 % de TVA.
- Pas d'avance sur frais ni de lettrage partiel : un remboursement partiel attend d'être complété pour lettrer la note.
- La limite des cadeaux (73 € TTC par bénéficiaire et par an) est vérifiée par ligne, pas sur l'année.
- Le cumul kilométrique de l'année compte les notes saisies dans Kledg : des trajets remboursés hors de Kledg dans l'année ne sont pas connus.
- Repas de l'exploitant : les circonstances exceptionnelles qui justifieraient une dépense au-delà de la limite (BOI-BNC-BASE-40-60-60, § 150) ne sont pas saisies ; le comptable les apprécie et corrige l'écriture. Les seuils ne s'appliquent qu'au compte 62568 : Kledg ne prépare pas la 2031-SD ni la 2035-SD.
