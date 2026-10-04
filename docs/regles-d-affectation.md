# Règles d'affectation

Une règle d'affectation dit à Kledg quelle écriture passer pour les transactions bancaires qui se ressemblent : même fournisseur, même libellé, même sens. Elle se crée depuis la page **Règles d'affectation** ou depuis une transaction (**Créer une règle à partir de cette transaction** dans la fenêtre « Traiter la transaction »), qui préremplit les conditions et un nom tiré de la contrepartie ou du libellé nettoyé (« CB Billet de train 12/03 » devient « Billet de train »). Le nom reste modifiable.

## Quand une règle s'applique

Une règle correspond à une transaction quand **toutes** ses conditions sont remplies. Le nombre de conditions ne change rien à l'application : une règle d'une seule condition s'applique comme une règle de cinq.

| Où | Règles appliquées |
| --- | --- |
| File de la page **Rapprochement** | Chaque transaction affiche les règles actives qui lui correspondent ; un clic sur la règle crée l'écriture. |
| Bouton **Appliquer les règles** (page Rapprochement) et outil MCP `run_rules` | Toutes les règles actives, sur les transactions à rapprocher de l'exercice en cours. |
| **Actualiser** (en-tête de l'application) | Seulement les règles où **Créer automatiquement l'écriture** est coché. Les autres restent des suggestions. |

Quand plusieurs règles correspondent à une même transaction, Kledg retient la priorité la plus haute, puis la règle la plus précise (celle qui a le plus de conditions).

## Écritures créées

Une règle crée toujours l'écriture **en brouillon**, rapprochée de sa transaction. Le brouillon reçoit son numéro définitif quand vous le validez dans **Écritures** (PCG art. 1031-3) ; jusque-là, il se corrige ou se supprime, et annuler le rapprochement le supprime.

L'ancienne case « Nécessite une approbation » n'existe plus : toutes les écritures des règles attendent déjà votre validation. La colonne correspondante reste dans la base pour les versions publiées, mais n'est plus lue.

Avant cette version, **Appliquer les règles** n'utilisait que les règles d'au moins trois conditions (un seuil de « confiance » de 80 % jamais affiché), tandis que l'actualisation appliquait toutes les règles, cochées ou non. Les deux suivent désormais le tableau ci-dessus. Pour que rien ne change à la mise à jour, les règles actives qui existaient avant reçoivent **Créer automatiquement l'écriture** (migration `20261011110000_keep_existing_rules_auto_applied`) : l'actualisation continue de créer leurs écritures. Une nouvelle règle garde le choix fait dans la fenêtre de la règle.
