# Abonnements

Les paiements récurrents repérés dans les opérations bancaires de la société (logiciels, forfaits, loyers, assurances), avec leur coût annuel, leur prochaine échéance et ce qui a changé. Code : `lib/subscriptions`, page `/subscriptions` (Banque, Abonnements), outils MCP `list_detected_subscriptions` et, avec l'accès brouillons, `classify_subscription` et `add_subscription_to_budget`.

## Détection

API `GET /api/subscriptions?companyId=` (droit `banking:read`).

- **Ce qui est lu** : les opérations des comptes bancaires de la société des trois dernières années (20 000 au plus, les plus récentes), sans les opérations refusées ou annulées par la banque. Les opérations datées après aujourd'hui sont ignorées.
- **Contrepartie** : le nom de contrepartie donné par la banque, sans forme juridique, sinon les premiers mots du libellé sans ce qui change d'un paiement à l'autre (dates, références, numéros de carte, « PRLV SEPA », « CB »).
- **Montants** : les débits d'une contrepartie dont les montants sont à moins de 25 % les uns des autres forment une série ; une hausse de prix reste dans sa série, deux formules très différentes du même fournisseur font deux séries. Deux formules proches payées le même mois sont séparées par montant exact.
- **Rythme** : hebdomadaire, mensuel, trimestriel ou annuel. Chaque écart entre deux paiements doit faire un nombre entier de périodes, à quelques jours près (2 jours par semaine, 5 par mois, 8 par trimestre, 10 par an) pour les week-ends, les jours fériés et les mois de 28 à 31 jours. Les mois sont des mois civils : un paiement du 31 tombe le 28 ou le 29 février et le 30 avril, puis revient au 31 ; le 29 février d'une année bissextile donne le 28 février de l'année suivante.
- **Paiements manqués** : un mois sans paiement compte comme un paiement manqué, la série reste détectée tant qu'au plus un quart des paiements attendus manquent.
- **Minimum** : 4 paiements par semaine, 3 par mois ou par trimestre, 2 par an au même prix. Un paiement isolé, deux achats à un mois d'écart ou deux achats à un an d'écart à des prix différents ne sont pas des abonnements.
- **Remboursements** : les crédits ne sont jamais des abonnements. Un crédit de la même contrepartie et du même montant dans les 45 jours qui suivent un débit l'annule : un prélèvement passé deux fois puis remboursé compte une fois.
- **Montant actuel** : le nouveau prix après une hausse, sinon la médiane des trois derniers paiements. Le **coût annuel** est ce montant multiplié par 52, 12, 4 ou 1.
- **Statut** :
  - *Prix modifié* : le montant a changé une fois et le nouveau prix a été payé au plus trois fois ;
  - *Peut-être arrêté* : le prochain paiement attendu a plus de 5, 10, 20 ou 30 jours de retard (semaine, mois, trimestre, année) à la date de la dernière opération lue, pas à la date du jour : une société qui importe ses relevés une fois par mois ne voit pas tous ses abonnements en retard ;
  - *Actif* sinon. Un montant qui varie à chaque paiement (énergie, usage) est signalé comme variable, sans « prix modifié ».
- **Compte suggéré** : le compte de classe 6 débité par l'écriture du dernier paiement rapproché, pour choisir la ligne du budget.

La détection est refaite à chaque lecture et n'est pas enregistrée : elle dépend d'opérations qu'une synchronisation, un import ou une suppression changent à tout moment, et elle porte sur quelques milliers de lignes. Deux lectures des mêmes opérations donnent les mêmes abonnements, dans le même ordre (coût annuel décroissant).

## Charges récurrentes hors abonnements

Les salaires, les cotisations sociales, les impôts, les comptes courants d'associés et les remboursements d'emprunt reviennent aussi à date fixe, mais ce ne sont pas des abonnements. Ils restent détectés, avec le type `recurring_charge` et un motif, sous l'onglet « Charges récurrentes » de la page, et ne comptent ni parmi les abonnements actifs ni dans le coût annuel.

- **Par l'écriture rapprochée** (prioritaire) : quand un paiement est rapproché d'une écriture (`bank_transactions.reconciledWith`, posé par le rapprochement, `lib/reconciliation/service.ts`), sa contrepartie est le compte débité du plus gros montant hors classe 5. Les comptes 16 (emprunts), 42 (personnel : 421, 425...), 43 (organismes sociaux : 431, 437...), 44 (État : 444, 445, 447...) 455 (associés, comptes courants), ainsi que les charges parfois passées directement sans compte de tiers, 63 (impôts et taxes, dont la CFE), 64 (personnel, dont 645 à 647 pour les cotisations, 646 pour celles de l'exploitant) et 661 (intérêts), en font une charge récurrente (PCG art. 932-1) ; tout autre compte (loyer 613, assurance 616, fournisseur 401) en fait un abonnement. Le dernier paiement rapproché de la série décide, même contre le libellé.
- **Par le libellé**, pour une série sans paiement rapproché : une liste prudente de bénéficiaires français de la paie et des impôts, en mots entiers de la contrepartie ou du libellé : `SALAIRE`, `URSSAF`, `AGIRC`, `ARRCO`, `RETRAITE COMPLEMENTAIRE`, `POLE EMPLOI`, `FRANCE TRAVAIL`, `DGFIP`, `IMPOTS` (dont impots.gouv), `IMPOT`, `TRESOR PUBLIC`, `FINANCES PUBLIQUES` (`lib/subscriptions/detect.ts`, `recurringChargeOfText`). Les mutuelles, les caisses de prévoyance et les logiciels de paie n'y sont pas : ils peuvent être de vrais abonnements, l'utilisateur les ignore au besoin.
- **Correction** : « Compter comme abonnement » confirme une charge récurrente, qui compte alors parmi les abonnements ; la remettre à traiter la renvoie dans son onglet.

## Décisions

API `PUT /api/subscriptions/decision` (droit `banking:reconcile`).

- **Confirmer** un abonnement, **l'ignorer** (un salaire, un virement entre ses comptes, un faux positif) ou le **remettre à traiter**. Seules ces décisions sont enregistrées (table `subscription_decisions`).
- Une décision porte sur la contrepartie, le rythme et le montant au moment de la décision. Elle suit la série de même contrepartie et de même rythme au montant le plus proche (au plus du simple au double) : elle survit à une hausse de prix, et deux formules du même fournisseur gardent chacune la leur.
- Le serveur détecte de nouveau l'abonnement à partir des opérations : un client n'envoie jamais la contrepartie ou le montant à enregistrer. Un abonnement que les opérations ne montrent plus répond 404. Les décisions d'une société s'écrivent sous un verrou, si bien que deux clics n'en créent pas deux.
- Les abonnements ignorés ou peut-être arrêtés ne comptent pas dans le total des abonnements actifs.

## Budget

API `POST /api/subscriptions/budget-item` (droits `budgets:manage` et `banking:reconcile`).

- Ajoute l'abonnement comme élément récurrent d'une ligne de charges (classe 6) d'un budget ouvert ([budget](budget.md)) : son montant actuel, son rythme (mensuel, trimestriel, annuel), à partir du mois de son premier paiement, ce qui garde le rythme d'un paiement trimestriel ou annuel. La fenêtre propose la ligne qui couvre le compte suggéré.
- L'élément passe par le service des budgets, dans la même transaction que la décision : l'abonnement est confirmé et rattaché à la ligne, ou rien n'est écrit. Le budget d'un exercice clôturé est refusé, comme le même libellé au même rythme déjà sur la ligne.
- Un abonnement hebdomadaire n'a pas de fréquence de budget : ses montants se saisissent par mois sur la ligne.
- Rien n'est ajouté sans une action de l'utilisateur.

## Règles d'affectation

La page propose de créer une [règle d'affectation](regles-d-affectation.md) à partir du dernier paiement d'un abonnement (droit `ledger:manage`) : le formulaire des règles s'ouvre prérempli depuis cette opération.

## Hors de la détection

- Pas d'alerte planifiée quand un abonnement s'arrête ou change de prix : le statut se consulte sur la page ou par l'outil MCP.
- Plusieurs paiements identiques le même jour pour la même contrepartie (plusieurs licences prélevées séparément) ne forment pas une série.
- Les revenus récurrents (clients) ne sont pas détectés.

## MCP

`list_detected_subscriptions` (droit `banking:read`) : les abonnements détectés, en euros, avec leur statut, leur décision et la ligne de budget ; les abonnements ignorés (`includeIgnored`) et les charges récurrentes hors abonnements (`includeRecurringCharges`) sur demande.

Avec l'accès Lecture et brouillons (`kledg:write`), comme les routes :

- `classify_subscription` (droit `banking:reconcile`) : confirmer, ignorer, compter une charge récurrente comme abonnement, ou remettre à traiter ;
- `add_subscription_to_budget` (droits `budgets:manage` et `banking:reconcile`) : ajouter l'abonnement comme élément récurrent d'une ligne de charges et le confirmer, dans la même transaction.

Voir [mcp.md](mcp.md).
