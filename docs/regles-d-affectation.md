# Règles d'affectation

Le guide d'utilisation (à quoi servent les règles, étapes, priorités, erreurs fréquentes) est sur le site : [Créer des règles d'affectation](https://www.kledg.com/fr/docs/creer-des-regles-d-affectation). Cette page décrit le fonctionnement technique : application des règles, choix entre plusieurs règles, écritures créées et migration.

Une règle se crée depuis la page **Règles d'affectation** (**Nouvelle règle**), depuis la [bibliothèque de règles](bibliotheque-de-regles.md) (modèles prêts à l'emploi, ou copie depuis une autre société) ou depuis une transaction (**Créer une règle à partir de cette transaction**), qui préremplit les conditions et un nom tiré de la contrepartie ou du libellé nettoyé (« CB Billet de train 12/03 » devient « Billet de train »).

Code : `lib/transactions/manage-rules.service.ts` (création, modification), `lib/transactions/rule-matcher.ts` (correspondance), `lib/services/transactions/transaction-processing-service.ts` (application, option `onlyAutoCreate`), `lib/tasks/refresh-company.ts` (actualisation).


## La page d'une règle

Une règle se crée sur `/<société>/rules/new` et se modifie sur `/<société>/rules/<id>`, sans onglets : tout est visible sur une seule page.

- **Général** : nom, description, journal et priorité. La priorité se choisit entre Haute (10), Normale (0, valeur des nouvelles règles) et Basse (-10) ; **Avancé** donne le nombre exact, pour une valeur qui ne correspond à aucun des trois choix.
- **Conditions** : une ligne par condition (champ, opérateur, valeur). Une transaction est reconnue quand toutes les conditions sont remplies.
- **Écriture proposée** : les lignes de l'écriture et, pour chaque ligne avec TVA, d'où vient le montant de TVA (voir ci-dessous). Le **compte de TVA par défaut** y figure : il sert aux lignes avec TVA qui n'ont pas leur propre compte de TVA. Un message dit si l'écriture de l'aperçu est équilibrée ; une règle qui n'a pas de ligne de banque est soldée à l'application par une ligne sur le compte de banque, une règle qui a sa propre ligne de banque (51x) doit être équilibrée pour être enregistrée.
- **Options** : **Règle active** et **Créer automatiquement l'écriture**.
- **Aperçu** (à droite, sous le formulaire sur téléphone) : pendant la saisie, le nombre de transactions des 90 derniers jours que les conditions reconnaissent (2 000 transactions au plus), les trois plus récentes avec la TVA détectée par la banque, et l'écriture proposée pour l'une d'elles avec la TVA comptabilisée. Sans transaction reconnue, l'écriture est simulée sur un exemple (100 € au débit par défaut). L'aperçu rappelle aussi le régime de TVA de la société (TVA sur les prestations exigible à l'encaissement ou d'après les débits).

Les liens « Créer une règle à partir de cette transaction » (fenêtre « Traiter la transaction »), la liste des abonnements et la liste Démarrer ouvrent `/rules/new` avec la transaction dans l'adresse ; les anciens liens vers `/rules?fromTransaction=` y mènent aussi.

### TVA détectée par la banque

Pour chaque ligne avec TVA, **Montant de TVA** propose :

- **TVA détectée par la banque** : Kledg reprend la TVA que la banque fournit pour la transaction (Qonto aujourd'hui : montant de TVA, sinon taux ; un taux négatif, que Qonto renvoie pour un taux non standard, est ignoré). Si la banque n'a pas détecté de TVA, le **taux de secours** de la ligne s'applique ; sans taux, la ligne est passée sans TVA.
- **Taux saisi** : le taux de la ligne s'applique à chaque transaction.

Quand une connexion Qonto existe, une ligne qui passe à la TVA collectée ou déductible commence sur **TVA détectée par la banque** ; sinon, et toujours pour la TVA intracommunautaire et à l'import (la banque ne voit pas de TVA sur ces achats), sur **Taux saisi**.

La case **TVA collectée au débit (avoir client)** passe la TVA collectée de la ligne au débit, pour un avoir. Elle n'a rien à voir avec l'option pour la TVA d'après les débits de la société (paramètres de TVA, CGI art. 269, 2, c), qui ne change pas le sens de l'écriture.

## Quand une règle s'applique

Une règle correspond à une transaction quand **toutes** ses conditions sont remplies. Le nombre de conditions ne change rien à l'application : une règle d'une seule condition s'applique comme une règle de cinq.

| Où | Règles appliquées |
| --- | --- |
| File de la page **Rapprochement** | Chaque transaction affiche les règles actives qui lui correspondent ; un clic sur la règle crée l'écriture. |
| Bouton **Appliquer les règles** (page Rapprochement) et outil MCP `run_rules` | Toutes les règles actives, sur les transactions à rapprocher de l'exercice en cours. |
| **Actualiser** (en-tête de l'application) | Seulement les règles où **Créer automatiquement l'écriture** est coché. Les autres restent des suggestions. |

Quand plusieurs règles correspondent à une même transaction, Kledg retient la priorité la plus haute, puis la règle la plus précise (celle qui a le plus de conditions).

## Écritures créées

Une règle crée toujours l'écriture **en brouillon**, rapprochée de sa transaction. Le brouillon reçoit son numéro définitif à la validation (PCG art. 1031-3) ; jusque-là, il se corrige ou se supprime, et annuler le rapprochement le supprime.

La case « Nécessite une approbation » a été retirée : toutes les écritures des règles attendent déjà une validation. La colonne correspondante reste dans la base pour les versions publiées, mais n'est plus lue.

Avant cette version, **Appliquer les règles** n'utilisait que les règles d'au moins trois conditions (un seuil de « confiance » de 80 % jamais affiché), tandis que l'actualisation appliquait toutes les règles, cochées ou non. Les deux suivent désormais le tableau ci-dessus. Pour que rien ne change à la mise à jour, les règles actives qui existaient avant reçoivent **Créer automatiquement l'écriture** (migration `20261011110000_keep_existing_rules_auto_applied`) : l'actualisation continue de créer leurs écritures. Une nouvelle règle garde le choix fait sur la page de la règle.
