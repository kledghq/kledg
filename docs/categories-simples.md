# Catégories simples et dépenses à vérifier

Le mode simple s'adresse aux personnes qui ne connaissent pas la comptabilité. Au lieu de choisir des comptes et des taux de TVA, elles confirment une **catégorie en langage courant** (« Téléphone et internet », « Repas d'affaires ») pour chaque paiement de la banque. Kledg en déduit l'écriture complète, et l'expert-comptable la valide.

Cette page décrit le catalogue des catégories, la façon dont Kledg propose une catégorie, la page **Dépenses à vérifier**, la validation par l'expert-comptable et les outils MCP. Le code est dans `lib/simple`.

## Catalogue des catégories

`lib/simple/categories.ts` compte 69 catégories, regroupées pour la recherche : Locaux, Équipement, Achats et sous-traitance, Communication et logiciels, Déplacements et repas, Véhicule, Services et honoraires, Banque et finances, Personnel et dirigeant, Impôts et taxes, Mouvements d'argent, Recettes. Chacune donne :

- le **compte du PCG 2026** (art. 932-1, liste des comptes) parmi ceux que Kledg crée dans chaque plan (comptes de quatre chiffres au plus, plus 44562, 44566 et 44571) ;
- le **taux de TVA par défaut** (CGI art. 278 : 20 % ; art. 279 : 10 % pour la restauration et le transport de voyageurs ; art. 278-0 bis : 5,5 % pour les livres), remplacé par la TVA que la banque a lue sur le justificatif quand elle en donne une plausible (au plus 20 % de la base) ;
- la **règle de récupération de la TVA**, celle des notes de frais (`lib/expense-reports/vat-recovery.ts`) ;
- une phrase d'aide, des mots-clés de recherche et la **source** (article du PCG, article du CGI ou BOFiP).

Exemples :

| Catégorie | Compte | TVA | Récupération |
| --- | --- | --- | --- |
| Téléphone et internet | 626 | 20 % | totale |
| Logiciels et abonnements | 6511 (solutions informatiques, règlement ANC n° 2022-06) | 20 % | totale |
| Déplacements (train, avion, taxi, VTC) | 6251 | 10 % | aucune (CGI ann. II art. 206, IV, 2, 5°) |
| Hôtel en déplacement | 6256 | 10 % | aucune (206, IV, 2, 2°) |
| Repas d'affaires | 6257 ou 6256 | 10 % | totale (ancien art. 236, abrogé par le décret n° 2007-566) |
| Carburant | 6061 | 20 % | 80 % pour une voiture de tourisme (CGI art. 298, 4, 1°, a), totale pour un utilitaire |
| Location ou entretien d'un véhicule | 6135, 6155 | 20 % | aucune pour une voiture de tourisme (206, IV, 2, 6°) |
| Cadeaux clients | 6234 | 20 % | jusqu'à 73 € TTC par bénéficiaire (206, IV, 2, 3° ; ann. IV art. 28-00 A) |
| Assurances, frais bancaires, courrier | 616, 627, 626 | sans TVA | (CGI art. 261 C, 261, 4, 5°) |
| Cotisations sociales du dirigeant | 646 | sans TVA | |
| TVA payée aux impôts, impôt sur les sociétés | 4455, 444 | mouvement, une seule ligne | |
| Ventes de prestations | 706 | 20 % collectée (44571) | |

Les mouvements qui ne sont ni des charges ni des produits (TVA payée, impôt sur les sociétés, salaires nets versés, charges sociales, emprunts, virements internes, retrait d'espèces, comptes courants, dividendes, capital) sont réservés en une seule ligne sur leur compte de tiers ou de trésorerie, sans TVA.

### Questions

Quelques catégories ne peuvent pas être comptabilisées sans une précision. Elles posent **une question** en langage courant, et chaque réponse dit quel compte et quelle règle de TVA s'appliquent :

| Question | Catégories | Réponses |
| --- | --- | --- |
| « Allez-vous l'utiliser plus d'un an ? » | Matériel informatique, Mobilier de bureau, Outils et machines | Oui : immobilisation (2183, 2184, 2155) avec la TVA au 44562, créée avec son plan d'amortissement ([Immobilisations](#immobilisations)). Non : charge (6063). Posée seulement au-delà de 500 € HT (tolérance BOI-BIC-CHG-20-30-10 ; PCG art. 212-1 et 213-1). |
| « Avec qui était ce repas ? » | Repas d'affaires | Avec des clients ou partenaires (6257, par défaut) ou seul en déplacement (6256). La note nomme les invités pour le comptable. |
| « C'est pour quel véhicule ? » | Carburant, Location ou leasing de véhicule, Entretien et réparation du véhicule | Voiture de tourisme ou utilitaire. |
| « Votre bail ou votre quittance mentionne-t-il de la TVA ? » | Loyer des locaux | Avec ou sans TVA (CGI art. 261 D, 2° et 260, 2°). |

La réponse sur le véhicule et sur le loyer est reprise pour la même contrepartie la fois suivante ; celle sur un achat durable est redemandée à chaque achat.

### Immobilisations

Quand l'utilisateur répond « Oui » à « Allez-vous l'utiliser plus d'un an ? », Kledg crée l'immobilisation avec l'écriture, dans la même transaction de la base, par le service des immobilisations (`createFixedAssetInTx`, `lib/fixed-assets/create-fixed-asset.service.ts`) :

- **libellé** : la catégorie et la contrepartie (« Matériel informatique (Apple Store Opera) ») ;
- **valeur d'acquisition** : la ligne au débit du compte d'immobilisation, hors TVA récupérée (PCG art. 213-1 ; la TVA non récupérable reste dans le coût) ;
- **date d'acquisition et début d'amortissement** : la date de la transaction, le bien étant mis en service le jour de son paiement (PCG art. 214-13) ;
- **amortissement linéaire** sur la durée par défaut de la catégorie (`lib/simple/asset-lifetimes.ts`), au crédit du 2815 ou du 2818, en dotation au 6811 (PCG art. 932-1) ;
- **payée** (le paiement est la transaction bancaire), avec un commentaire qui rappelle d'où elle vient.

| Catégorie | Compte | Amortissement | Durée | Source |
| --- | --- | --- | --- | --- |
| Matériel informatique | 2183 | 2818 | 3 ans | usage admis pour le matériel informatique (obsolescence rapide), plus court que le matériel de bureau (10 à 20 %) |
| Mobilier de bureau | 2184 | 2818 | 10 ans | mobilier : 10 % par an |
| Outils et machines | 2155 | 2815 | 5 ans | outillage : 10 à 20 % par an (matériel : 10 à 15 %), durée la plus courte retenue |

Taux usuels : BOI-BIC-AMT-10-40-30, I-B et I-C ; durée d'utilisation : PCG art. 214-1 et 214-4, CGI art. 39, 1-2° (« d'après les usages de chaque nature d'industrie »). Le comptable peut changer la durée dans Immobilisations avant de comptabiliser la première dotation, par exemple pour une machine amortie sur 7 à 10 ans.

L'immobilisation est **liée à son écriture d'acquisition** (`fixed_assets.acquisitionEntryId`), et la ligne du mode simple la nomme (`simple_mode_entries.fixedAssetId`). Elle suit l'écriture :

- **annuler le rapprochement** ou **supprimer le brouillon** supprime d'abord l'immobilisation, selon les règles de suppression des immobilisations (`deleteFixedAssetsAcquiredByEntryInTx`, `lib/fixed-assets/delete-fixed-asset.service.ts`) : ses dotations en brouillon partent avec elle ; une dotation comptabilisée, ou une subvention d'investissement qui la finance, fait refuser l'annulation (409), avec la raison (« Le rapprochement ne peut pas être annulé : l'écriture n° ... a créé l'immobilisation « ... », qui ne peut pas être supprimée. Cette immobilisation a 1 dotation aux amortissements comptabilisée... ») ;
- la clé étrangère (`ON DELETE NO ACTION`) refuse tout autre chemin qui supprimerait l'écriture en laissant l'immobilisation ;
- une immobilisation supprimée à la main dans Immobilisations laisse l'écriture telle quelle ; la ligne du mode simple ne la nomme plus.

Avec la validation par l'expert-comptable, l'immobilisation est créée avec le brouillon. La liste des saisies du mode simple l'indique sous la catégorie : « Immobilisation créée : Matériel informatique (Apple Store Opera), amortie sur 3 ans ». Si le comptable requalifie l'achat en charge, il supprime l'immobilisation dans Immobilisations avant de corriger l'écriture.

Une société exonérée de TVA récupère la part donnée par son prorata du mois (`lib/accounting/vat-recovery-ratio.ts`) : rien pour une franchise sans ventes taxées. Elle ne collecte pas de TVA sur ses ventes.

Les comptes du catalogue sont ceux du plan que Kledg crée. Pour un plan importé d'un FEC, Kledg prend le compte détaillé (626000, sinon le plus petit sous-compte), sinon le compte parent le plus proche (`lib/simple/ledger-accounts.ts`). Sans compte proche, la dépense n'est pas enregistrée et l'utilisateur est invité à faire compléter le plan.

## Proposition d'une catégorie

`lib/simple/suggest.ts` est un moteur pur et déterministe. Pour une transaction non rapprochée, il propose une catégorie avec une confiance (haute, moyenne ou basse) et une raison en clair. Les signaux, dans l'ordre :

1. **Les règles d'affectation** de la société : la meilleure règle qui correspond (priorité, puis nombre de conditions). Confirmer applique les lignes de la règle, comme « Appliquer la règle » ; la catégorie affichée est celle de son compte principal.
2. **L'historique de la contrepartie** : les catégories choisies en mode simple et, pour les transactions rapprochées en mode expert, le compte de leur écriture. La contrepartie est normalisée comme pour les abonnements (`counterpartyKey`, `lib/subscriptions/detect.ts`). Le même choix les dernières fois donne une confiance haute (« Comme les 6 dernières fois »), un seul choix une confiance moyenne, des choix divergents une confiance selon leur part.
3. **Le dictionnaire des payeurs français** (`lib/simple/payees.ts`) : opérateurs, éditeurs de logiciels, hébergeurs, régies publicitaires, transporteurs, hôtels, stations-service, autoroutes et parkings, fournisseurs d'énergie, assureurs, banques en ligne, prestataires de paiement, greffes... L'URSSAF des indépendants va aux cotisations du dirigeant, l'URSSAF seule aux charges sociales des salariés ; les impôts (DGFIP) vont à la TVA, à l'impôt sur les sociétés, aux taxes locales ou au prélèvement à la source selon le libellé. Un payeur reconnu sans savoir ce qui a été acheté (Amazon, PayPal, la DGFIP sans détail) reste **à classer**, avec une indication.
4. **Les mots du libellé** : restaurant, loyer, péage, salaire, agios, retrait...
5. **La catégorie de la banque** (catégories Qonto), quand elle désigne une seule catégorie du catalogue.

Une catégorie de dépense n'est jamais proposée pour une entrée d'argent, ni une recette pour une sortie. En dessous de la confiance moyenne, rien n'est proposé : la ligne est « à classer ». Kledg n'invente jamais de catégorie.

## Dépenses à vérifier

La page `/<société>/simple/depenses` (mode simple) liste les paiements non rapprochés, du plus récent au plus ancien, avec la catégorie proposée et sa raison :

- **OK** confirme la proposition ;
- **Modifier** ouvre la liste des catégories (recherche par mot, sans accent), la question éventuelle, la note pour le comptable et l'envoi du justificatif ;
- une ligne qui pose une question se règle d'un clic sur la réponse ;
- **Tout confirmer** ne confirme que les lignes de confiance haute sans question ; le serveur recalcule chaque proposition avant de confirmer ;
- une ligne dont la date n'est couverte par aucun exercice ouvert le dit et ne peut pas être confirmée.

Confirmer crée l'écriture par le service du rapprochement (`createEntryAndReconcile`) : la transaction est réservée sous verrou, l'écriture créée par le seul chemin de création (`createEntryInTx`) avec la ligne de banque au 512, la charge ou le produit et la TVA, au journal BQ, dans l'exercice de la date, puis liée à la transaction, le tout dans une seule transaction de la base. Une seconde confirmation répond 409. Annuler le rapprochement supprime le brouillon, comme pour tout rapprochement, et l'immobilisation créée avec lui (voir [Immobilisations](#immobilisations)).

Le **justificatif** d'une transaction Qonto part chez Qonto (API des pièces jointes, clés de la société), puis Kledg en reprend la référence ; Kledg ne stocke aucun fichier. Les autres banques n'ont pas d'API équivalente : l'utilisateur garde la facture pour son comptable (Code de commerce art. L123-22). L'envoi compte dans la limite d'appels bancaires de la société.

**Règle apprise** : quand les trois dernières confirmations pour une même contrepartie ont choisi la même catégorie, et que cette catégorie se comptabilise toujours de la même façon (pas de question qui dépend de l'achat, pas de récupération partielle de la TVA qu'une règle ne sait pas exprimer : carburant, cadeaux), Kledg crée une règle d'affectation « <contrepartie> (mode simple) » : contrepartie (ou libellé) et sens de l'opération, compte et TVA de la catégorie. Elle reste une suggestion (pas de création automatique). Trois choix identiques d'une autre catégorie mettent à jour la règle que le mode simple avait créée.

Fonctions pour l'accueil du mode simple : `countExpensesToReview(companyId)` (`lib/simple/expenses-to-review.service.ts`) et `simpleValidationSummary(companyId, { from, to })` (`lib/simple/simple-validation.service.ts`), qui compte les écritures du mode simple de la période, validées et à valider.

## Validation par l'expert-comptable

Réglage de la société « **Faire valider les saisies du mode simple par l'expert-comptable** » (`companies.simpleModeAccountantReview`, `GET/PUT /api/companies/[id]/simple-mode-settings`, droit `settings:update`) :

- tant qu'il n'a pas été choisi, il est **activé dès qu'un membre a le rôle Comptable** (décision du mainteneur, 2026-10-04) ;
- activé, les écritures confirmées en mode simple restent en **brouillon « à valider »** : rien n'est définitif avant la validation (PCG art. 1031-3) ;
- désactivé, elles sont validées aussitôt quand l'utilisateur a le droit de valider les écritures, sinon elles restent en brouillon.

Chaque écriture du mode simple est marquée par une ligne de `simple_mode_entries` : catégorie, réponses, note, contrepartie normalisée, validation demandée, origine (page ou assistant), règle apprise, immobilisation créée. La table est protégée par la sécurité au niveau des lignes ([rls.md](rls.md)) ; une ligne disparaît avec son écriture.

En mode expert, **Saisie, Saisies du mode simple** (`/<société>/entries/simple-mode`, droit `entries:read`) liste ces écritures, les brouillons à valider d'abord, avec la catégorie, la réponse à la question, la note, l'immobilisation créée, l'absence de justificatif et les lignes de l'écriture. Le comptable les valide une par une ou ensemble par la validation habituelle (`POST /api/entries/bulk-validate`, numéro définitif dans l'ordre des dates), ou les corrige dans le formulaire d'écriture. Le récapitulatif du mois donne les écritures classées, validées et à valider.

## API

| Route | Droit | Rôle |
| --- | --- | --- |
| `GET /api/simple/expenses?companyId=&side=&limit=` | `banking:read` | Dépenses à vérifier avec leur proposition, le nombre total et le réglage de validation |
| `POST /api/simple/expenses/[id]/confirm` | `banking:reconcile` et `entries:create` | Confirmer la proposition, une catégorie (`categoryId`, `answers`) ou une règle (`ruleId`), avec une note ; 400 avec `question` tant qu'elle n'a pas de réponse |
| `POST /api/simple/expenses/confirm-all` | `banking:reconcile` et `entries:create` | Tout confirmer : seulement les lignes sûres, les autres dans `skipped` avec la raison |
| `POST /api/simple/expenses/[id]/receipt` | `banking:reconcile` | Envoyer le justificatif d'une transaction Qonto |
| `GET /api/simple/entries?companyId=&status=&from=&to=` | `entries:read` | Saisies du mode simple et récapitulatif de la période |
| `GET/PUT /api/companies/[id]/simple-mode-settings` | `settings:read` / `settings:update` | Réglage de validation par l'expert-comptable |

## Assistants (MCP)

- `list_expenses_to_review` (lecture, `banking:read`) : les dépenses à vérifier avec la catégorie proposée, la confiance, la source, la raison, la question à trancher et ses réponses, en euros.
- `accept_expense_suggestion` (brouillons, `kledg:write`, `banking:reconcile` et `entries:create`) : confirme une ligne par la même confirmation que la page, toujours en **brouillon**, quel que soit le réglage ; ne crée jamais de règle d'affectation. Écrit `MCP_WRITE` au journal d'audit.

Voir [mcp.md](mcp.md).
