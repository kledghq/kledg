# Membres et invitations

Une société a des membres, chacun avec un rôle (`lib/permissions.ts`) :
**Administrateur** (`companyAdmin`), **Comptable** (`accountant`) ou
**Lecture seule** (`viewer`). Le rôle d'administrateur de l'instance
(`user.role = 'admin'`) n'est pas un rôle de société et ne se donne jamais
depuis une société.

| Qui | Quoi | Où |
|---|---|---|
| Administrateur de l'instance | ajouter directement un membre (le compte est créé si besoin, email de bienvenue), changer un rôle | `POST /api/companies/[id]/members`, `PATCH /api/companies/[id]/members/[memberId]` (`adminRoute`), outil MCP `manage_members` |
| Membre qui a le droit `members:manage` (les administrateurs de la société, et l'administrateur de l'instance) | inviter une personne par email, lister les invitations en attente, les renvoyer, les annuler ; retirer un membre ([règles](#retrait-dun-membre)) | `GET/POST /api/companies/[id]/invitations`, `DELETE /api/companies/[id]/invitations/[invitationId]`, `POST .../[invitationId]/resend`, `DELETE /api/companies/[id]/members/[memberId]` (`companyRoute`), outils MCP `manage_invitations` et `manage_members` (action `remove`) |
| Tout membre | voir les membres et leurs rôles, quitter la société | `GET /api/companies/[id]/members`, `DELETE /api/companies/[id]/membership` |

Page **Membres** : bouton **Inviter un membre** (email et rôle), carte
**Invitations en attente** avec **Renvoyer** et **Annuler**, et sur chaque
membre **Retirer** (sur sa propre ligne, **Quitter**), désactivé avec la
raison quand le retrait n'est pas permis.

## Retrait d'un membre

Code : règles dans `lib/rbac/member-removal-rules.ts` (pures, aussi lues par
la page), retrait dans `lib/rbac/remove-member.service.ts`.

### Règles

Un membre qui a `members:manage` dans la société retire un autre membre,
sauf :

- un membre qui a un droit que lui n'a pas dans la société (même règle que
  le rôle d'une invitation : jamais plus de droits que les siens) ;
- un administrateur de l'instance ;
- le dernier membre capable de gérer les membres (rôle avec
  `members:manage`, ou administrateur de l'instance non banni) : la société
  n'aurait plus personne pour la gérer.

Tout membre peut **quitter la société** (`DELETE /api/companies/[id]/membership`),
sauf s'il est ce dernier membre. L'administrateur de l'instance retire
n'importe quel membre : il a tous les droits et atteint toutes les sociétés.
Un identifiant de membre d'une autre société répond 404, comme une société
dont on n'est pas membre. Une société en lecture seule (archivée, ou refusée
par la politique de l'instance) ne retire personne.

La décision et les écritures se font dans une transaction, sous un verrou
consultatif des membres de la société : deux administrateurs qui se retirent
l'un l'autre en même temps ne peuvent pas réussir tous les deux. Refus :
403 pour les droits, 409 pour le dernier administrateur.

### Effets

Le retrait coupe l'accès tout de suite :

- les lignes `member` de la personne pour la société sont supprimées.
  Chaque requête, chaque appel MCP et chaque politique de sécurité au
  niveau des lignes ([rls.md](rls.md)) relit l'appartenance : ses sessions
  ouvertes, ses clés API et ses assistants IA perdent la société à la
  requête suivante ;
- ses sessions dont l'organisation active était celle de la société la
  perdent (`session.activeOrganizationId`) ;
- les autorisations de ses assistants et de ses clés API sur la société
  sont supprimées (`ai_access_grant_companies`) : être ajouté de nouveau ne
  les rétablit pas. Une autorisation « toutes mes sociétés » reste, mais ne
  donne que les sociétés dont la personne est membre ;
- ses actions IA de la société en attente d'approbation, ou approuvées et
  pas encore exécutées, sont annulées (statut `rejected`) ;
- les invitations encore ouvertes qu'elle a envoyées pour la société sont
  annulées : son autorité part avec son accès.

Son compte n'est jamais supprimé, ni ce qu'elle a saisi : écritures, notes
de frais, journal d'audit gardent son nom.

Les écritures sont faites dans le contexte système `member-removal`
([rls.md](rls.md)) : l'appartenance, les autorisations et les actions en
attente d'un autre utilisateur ne s'écrivent que dans un contexte sans
restriction. Les droits de l'appelant sont vérifiés avant, dans son propre
contexte.

### Avis, journal, limites

- **Email** (`memberRemovedEmail`, `lib/email/templates.ts`) : la personne
  retirée par quelqu'un d'autre est prévenue, sauf `notify=false`
  (`DELETE .../members/[memberId]?notify=false`, ou `notify: false` de
  l'outil MCP). Rien n'est envoyé quand elle quitte la société elle-même.
  Un envoi qui échoue est journalisé et n'annule pas le retrait.
- **Journal d'audit** de la société : `MEMBER_REMOVED`, avec l'auteur (la
  personne connectée), la personne retirée (`userId`, `email`, `name`), son
  rôle, `self` quand elle est partie d'elle-même, et le nombre
  d'autorisations, d'actions IA et d'invitations annulées.
- **Limite** (`lib/rate-limit.ts`) : `member-removal`, 30 retraits par heure
  et par utilisateur.
- **MCP** : `manage_members` action `remove` (`members:manage`, à fort
  impact : approbation dans Kledg en mode validation). L'approbation couvre
  la ligne du membre : un changement de rôle entre l'approbation et
  l'exécution la refuse. Le retrait vérifie l'état approuvé dans sa propre
  transaction (`atomic` de l'outil). Quitter la société ne passe pas par un
  assistant (route exclue du serveur MCP).

## Invitations

Code : `lib/rbac/company-invitations.service.ts`, table
`company_invitations` (migration `20261128090000_company_invitations`), page
d'acceptation `app/(auth)/invitation/[token]`.

### Règles

- **Rôle plafonné** : le rôle donné ne peut accorder aucun droit que
  l'invitant n'a pas lui-même dans la société (`assertGrantable`, à partir du
  `can` de la route ou de l'outil MCP). Seuls les trois rôles de société sont
  acceptés (contrainte `CHECK` en base aussi).
- **Lien** : 32 octets aléatoires (256 bits) en base64url. Seule son
  empreinte SHA-256 est stockée (`tokenHash`) : la table ne contient aucun
  lien utilisable, et l'API ne le renvoie jamais, sauf à l'invitant quand
  aucun email ne peut le porter (envoi d'emails non configuré ou refusé par
  l'instance), pour qu'il le transmette lui-même. L'outil MCP ne le renvoie
  jamais. Un jeton aléatoire stocké haché remplace une signature : il ne se
  devine pas, ne se fabrique pas sans la base, et reste valable si le secret
  d'authentification change.
- **Validité** : 7 jours (`INVITATION_TTL_DAYS`). Une invitation sert une
  seule fois : l'acceptation pose `acceptedAt` par une mise à jour
  conditionnelle, la première seulement réussit. **Renvoyer** remplace le
  jeton (l'ancien lien cesse de marcher) et repart pour 7 jours.
  **Annuler** pose `revokedAt`.
- **Une invitation ouverte par adresse et par société** (verrou consultatif
  dans la transaction) ; une invitation expirée est fermée par la suivante.
  Un membre existant ne peut pas être invité.
- **Société en lecture seule** (archivée, ou refusée par la politique de
  l'instance) : ni envoi ni acceptation (`assertCompanyWritable`).
- **Limites** (`lib/rate-limit.ts`) : `member-invitation` (20 envois ou
  renvois par heure et par invitant), `invitation-email` (5 invitations par
  jour et par adresse, toutes sociétés confondues), `invitation-accept`
  (tentatives d'acceptation par adresse IP).
- **Journal d'audit** de la société : `MEMBER_INVITED`,
  `MEMBER_INVITATION_RESENT`, `MEMBER_INVITATION_REVOKED`,
  `MEMBER_INVITATION_ACCEPTED`.

### Acceptation

La page `/invitation/<jeton>` est publique (`proxy.ts`) : l'invité n'a pas
forcément de compte. Elle lit l'invitation par l'empreinte du jeton, dans le
contexte système `invitation-acceptance` ([rls.md](rls.md)), et propose :

| Situation | Page |
|---|---|
| Connecté avec le compte de l'adresse invitée (adresse confirmée) | **Rejoindre la société**, en un clic |
| Connecté avec un autre compte | explique qu'il faut se déconnecter et rouvrir le lien avec le bon compte |
| Un compte confirmé existe pour l'adresse | **Se connecter pour accepter** (retour sur le lien après la connexion) |
| Pas de compte, ou un compte jamais confirmé | création du compte (nom, mot de passe) puis connexion ; le lien prouve la boîte mail, l'adresse est marquée confirmée. Un compte jamais confirmé est d'abord réinitialisé (sessions, clés et assistants supprimés), comme pour un ajout par l'administrateur (KLEDG-SEC-011) |
| Pas de compte et l'instance refuse `invitation-sign-up` | demande à l'administrateur de l'instance de créer le compte ; le même lien sert ensuite |
| Lien inconnu, expiré, annulé ou déjà utilisé | message qui dit quoi faire |

L'acceptation vérifie de nouveau que l'instance autorise les invitations
(`invite-member`, avec l'invitant comme acteur) : désactiver les invitations
rend inutilisables les liens en attente.

### Politique de l'instance

Trois actions de `lib/instance/types.ts` ([extension-points.md](extension-points.md)) :

- `invite-member` : refusée, aucune invitation ne part et les liens en
  attente ne servent plus (les ajouts directs par l'administrateur de
  l'instance sont refusés aussi).
- `invitation-sign-up` : refusée, seul un compte existant peut accepter ;
  l'administrateur de l'instance crée les autres comptes.
- `remove-member` : décidée pour la personne qui agit (l'administrateur de
  l'instance compris) ; refusée, elle ne retire aucun membre et ne quitte
  pas la société.

Kledg autorise les trois. Une offre hébergée peut y ajouter ses propres
limites (par exemple un nombre de membres par offre) dans sa politique.
