# Membres et invitations

Une société a des membres, chacun avec un rôle (`lib/permissions.ts`) :
**Administrateur** (`companyAdmin`), **Comptable** (`accountant`) ou
**Lecture seule** (`viewer`). Le rôle d'administrateur de l'instance
(`user.role = 'admin'`) n'est pas un rôle de société et ne se donne jamais
depuis une société.

| Qui | Quoi | Où |
|---|---|---|
| Administrateur de l'instance | ajouter directement un membre (le compte est créé si besoin, email de bienvenue), changer un rôle, retirer un membre | `POST/PATCH/DELETE /api/companies/[id]/members` (`adminRoute`), outil MCP `manage_members` |
| Membre qui a le droit `members:manage` (les administrateurs de la société, et l'administrateur de l'instance) | inviter une personne par email, lister les invitations en attente, les renvoyer, les annuler | `GET/POST /api/companies/[id]/invitations`, `DELETE /api/companies/[id]/invitations/[invitationId]`, `POST .../[invitationId]/resend` (`companyRoute`), outil MCP `manage_invitations` |
| Tout membre | voir les membres et leurs rôles | `GET /api/companies/[id]/members` |

Page **Membres** : bouton **Inviter un membre** (email et rôle), carte
**Invitations en attente** avec **Renvoyer** et **Annuler**.

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

Deux actions de `lib/instance/types.ts` ([extension-points.md](extension-points.md)) :

- `invite-member` : refusée, aucune invitation ne part et les liens en
  attente ne servent plus (les ajouts directs par l'administrateur de
  l'instance sont refusés aussi).
- `invitation-sign-up` : refusée, seul un compte existant peut accepter ;
  l'administrateur de l'instance crée les autres comptes.

Kledg autorise les deux. Une offre hébergée peut y ajouter ses propres
limites (par exemple un nombre de membres par offre) dans sa politique.
