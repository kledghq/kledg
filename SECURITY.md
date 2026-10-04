# Politique de sécurité

Kledg manipule des données comptables et bancaires : la sécurité est prioritaire. La politique complète est publiée sur [www.kledg.com/fr/securite](https://www.kledg.com/fr/securite).

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.** Utilisez l'un de ces canaux privés :

- le [signalement privé de GitHub](https://github.com/kledghq/kledg/security/advisories/new) (recommandé) ;
- l'adresse security@kledg.com.

Indiquez la version ou le commit concerné, les étapes de reproduction, l'impact estimé et, si possible, une preuve de concept minimale.

## Périmètre

Le code de ce dépôt (dernière version de `main`), l'instance de démonstration demo.kledg.com et le site www.kledg.com. Les instances exploitées par des tiers, l'infrastructure des fournisseurs (Vercel, Neon, Resend, Qonto, GitHub), le déni de service, le spam et l'ingénierie sociale sont hors périmètre.

## Règles

Testez de préférence sur votre propre instance ; sur la démonstration, n'utilisez que les données de démonstration. Accédez au minimum de données nécessaire, ne les conservez pas, ne dégradez pas le service et laissez-nous le temps de corriger avant toute publication.

## Nos engagements

- accusé de réception sous 72 heures ;
- évaluation de la gravité sous 7 jours ;
- correction visée sous 30 jours pour une vulnérabilité critique ou haute, 90 jours pour les autres ;
- publication coordonnée d'un avis de sécurité GitHub, avec remerciements si vous le souhaitez.

Nous n'engagerons aucune action contre une personne qui signale de bonne foi une vulnérabilité en respectant cette politique.

## Protections en place

Ce que l'application garantit, pour vous aider à cibler vos tests (détails dans [docs/configuration.md](docs/configuration.md#sécurité) et [docs/mcp.md](docs/mcp.md)) :

- **Installation** : `/setup` refuse de créer le premier administrateur sans `SETUP_TOKEN` (16 caractères au moins).
- **Sessions** : chaque requête vérifie que la session existe toujours en base, que le compte n'est pas bloqué et quel est son rôle ; la réinitialisation du mot de passe ferme toutes les sessions, son changement ferme les autres par défaut. Les endpoints d'administration de Better Auth (`/api/auth/admin/*`) sont fermés en HTTP.
- **CSRF et taille des requêtes** : toute requête qui modifie des données et porte le cookie de session doit venir de l'instance (`Origin`, `Sec-Fetch-Site`) et être en JSON (ou multipart pour les fichiers) ; les corps sont comptés pendant leur lecture (1 Mo par défaut, 20 Mo pour les fichiers, 4,5 Mo au plus sur Vercel). Les classeurs Excel sont réellement décompressés sous un budget d'octets avant leur lecture.
- **En-têtes** : CSP à nonce, `X-Frame-Options: DENY`, HSTS, `nosniff`, politique de référent et de permissions.
- **Application installable** : le service worker ne met en cache que des fichiers publics (page hors ligne, icônes, fichiers de construction à empreinte) ; jamais `/api/*`, une page connectée ou une donnée comptable. La déconnexion supprime les fichiers mis en cache pendant la session et envoie `Clear-Site-Data: "cache"`. Détails dans [docs/configuration.md](docs/configuration.md#sécurité).
- **Adresse IP** : les en-têtes de proxy ne sont pris en compte que si `TRUST_PROXY_HOPS` (ou `RATE_LIMIT_IP_HEADER`) est défini, ou sur Vercel.
- **Livres comptables** : une société qui a des écritures validées ou un exercice clôturé ne peut pas être supprimée (conservation 10 ans, Code de commerce art. L123-22), seulement archivée ; le journal d'audit est en ajout seul (déclencheur de la base).
- **Isolation des sociétés dans la base** (`KLEDG_RLS=enforce`, [docs/rls.md](docs/rls.md)) : chaque table d'une société porte des politiques de sécurité au niveau des lignes ; l'application se connecte avec un rôle qui leur est soumis et chaque transaction indique qui agit. Une requête sans filtre de société ne lit ni n'écrit les lignes d'une société inaccessible, une écriture sans contexte est refusée, un assistant ne dépasse pas les sociétés autorisées. Hors périmètre : une injection SQL capable d'exécuter des requêtes arbitraires (elle pourrait changer le contexte) et l'existence d'une valeur unique (SIREN, identifiant) chez une autre société. Un contournement de ces politiques est une vulnérabilité.
- **Assistants IA** : en contrôle total, chaque connexion (assistant autorisé ou clé API) a un mode d'exécution des actions à fort impact (valider, contre-passer, supprimer, importer, clôturer...), choisi par l'utilisateur :
  - **Validation dans Kledg** : l'action doit être approuvée par l'utilisateur dans Kledg (session et mot de passe) avant de s'exécuter, une seule fois ; l'assistant ne peut pas l'approuver.
  - **Automatique** (par défaut, décision du mainteneur du 2026-10-04) : l'action s'exécute dès l'appel, sans approbation. Restent appliqués : la portée `kledg:admin`, les sociétés choisies, le rôle de l'utilisateur, la limite d'appels, le journal d'audit (qui nomme l'assistant et note « mode automatique ») et les invariants comptables des services et de la base (écritures validées définitives, exercices clôturés, numérotation). **Risque résiduel accepté** : un texte malveillant présent dans les données (libellé bancaire, relevé, pièce) peut pousser l'assistant à agir à la place de l'utilisateur dans ces limites (injection de requête). L'utilisateur en est averti au moment du choix et peut passer à la validation à tout moment ; le changement s'applique à l'appel suivant. Un signalement qui contourne ces limites reste une vulnérabilité ; une action à fort impact exécutée en mode automatique sur instruction de l'assistant n'en est pas une en soi.

  Une connexion sans choix de sociétés n'accède à aucune société ; une clé API sans niveau n'a que la lecture. Seuls Claude et ChatGPT identifiés par leur document de métadonnées (CIMD) sur claude.ai et chatgpt.com portent leur marque sur la page d'autorisation.

## Versions prises en charge

Seule la dernière version publiée reçoit des correctifs de sécurité. Gardez votre instance à jour (voir [docs/self-hosting.md](docs/self-hosting.md#mettre-à-jour)).
