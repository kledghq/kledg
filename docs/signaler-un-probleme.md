# Signaler un problème ou proposer une idée

Le guide d'utilisation est sur le site : [Signaler un problème ou proposer une idée](https://www.kledg.com/fr/docs/references/signaler-un-probleme). Cette page décrit le fonctionnement technique : code, contexte ajouté, configuration et limites.

Depuis Kledg, l'utilisateur prépare une issue GitHub préremplie à partir des modèles du dépôt (`.github/ISSUE_TEMPLATE/bug_report.yml` et `feature_request.yml`), la relit sur GitHub et l'envoie depuis son propre compte. Kledg ne crée jamais d'issue lui-même et n'appelle pas GitHub. Code : `lib/feedback` (lien et contexte, pur), `components/features/feedback` (fenêtre), outil MCP `prepare_feedback` (`lib/mcp/feedback-tools.ts`).

## Où le trouver

- Menu **Aide** de l'en-tête (le point d'interrogation) : **Signaler un problème** et **Proposer une idée**, sur toutes les pages de l'application (sociétés et paramètres).
- Pages d'erreur (`app/error.tsx`) : **Signaler le problème** prépare un signalement avec la référence de l'erreur (le `digest` de Next.js, qui permet de retrouver l'erreur dans les journaux du serveur). Au-dessus du cadre de l'application, la fenêtre prend la version du paquet et le dépôt par défaut.
- Assistants IA : l'outil `prepare_feedback` (lecture seule, tout utilisateur connecté, hors de toute société) renvoie le lien de l'issue préremplie et la recherche des issues existantes ; l'utilisateur ouvre le lien.

## Le lien

GitHub préremplit un formulaire d'issue par les paramètres de l'adresse : `template` (nom du fichier), `title` et un paramètre par `id` de champ. `FEEDBACK_TEMPLATES` (`lib/feedback/issue-url.ts`) liste les `id` utilisés ; un test vérifie qu'ils existent dans les fichiers YAML, pour que le formulaire suive les modèles.

| Type | Modèle | Champs préremplis |
|---|---|---|
| Problème | `bug_report.yml` | `what` (description et contexte technique), `steps` (étapes), `version` (version et commit) |
| Idée | `feature_request.yml` | `need` (besoin et contexte technique), `proposal` |

Titre limité à 120 caractères, textes à 4 000. Les textes sont raccourcis pour que le lien reste sous 7 500 caractères (au-delà, navigateurs et GitHub le coupent). **Est-ce déjà signalé ?** ouvre la recherche des issues du dépôt avec les mots du titre.

## Contexte technique

Affiché dans la fenêtre avant l'envoi et ajouté à la description :

- version et commit de l'instance, hébergeur (`lib/updates/version.ts`, `lib/updates/hosting.ts`) ;
- page, sous forme de motif de route : chaque paramètre de la page (slug de la société, identifiant d'une écriture) est remplacé par son nom (`/[companyId]/entries/[entryId]`), les autres identifiants (nombres, cuid, uuid) par `[id]`, la requête et l'ancre sont retirées ;
- mode d'affichage (pages des sociétés), navigateur et système (nom et version majeure, pas l'agent utilisateur complet), langue du navigateur ;
- référence de l'erreur, depuis une page d'erreur.

Jamais de données comptables, de nom de société, de montant ni d'identifiant. Ce que l'utilisateur écrit lui-même est public sur GitHub : la fenêtre le rappelle.

## Configuration

`KLEDG_FEEDBACK_REPO` (`owner/nom`) envoie les signalements d'une instance vers son propre dépôt, par exemple le dépôt d'une instance personnalisée qui a ses propres modèles d'issue avec les mêmes `id`. Par défaut, ou si la valeur n'est pas un nom de dépôt : `kledghq/kledg`.

## Limites

- Il faut un compte GitHub pour envoyer. Un envoi au support par email pour l'offre hébergée n'est pas encore proposé.
- Pas de capture d'écran : l'utilisateur la joint à la main sur GitHub.
- Les failles de sécurité ne passent pas par ce formulaire : le dépôt les reçoit en privé (`.github/ISSUE_TEMPLATE/config.yml`).
