# Structure des fichiers de configuration

## 📋 Vue d'ensemble

Il existe des fichiers de configuration par défaut pour le **Bilan** et le **Compte de Résultat**, avec différentes variantes (complet/simplifié) et formats (ancien/nouveau).

## 📊 Bilan (Balance Sheet)

### Fichiers actifs (utilisés)

1. **`default-pcg-config-complete-2026.ts`** ✅
   - Format : Nouveau (structure nested avec `children`)
   - Variante : `complete`
   - Utilisé par : `create-default-pcg-config.service.ts`
   - Structure : Hiérarchique avec `parentId` (pas de `linePath`)

2. **`default-pcg-config-simplified-2026.ts`** ✅
   - Format : Nouveau (structure nested avec `children`)
   - Variante : `simplified`
   - Utilisé par : `create-default-pcg-config.service.ts`
   - Structure : Hiérarchique avec `parentId` (pas de `linePath`)

### Fichiers obsolètes (non utilisés)

3. **`default-pcg-configs.ts`** ❌ **SUPPRIMÉ**
   - Format : Ancien (avec `linePath`)
   - Variantes : `complete` et `simplified`
   - **A ÉTÉ SUPPRIMÉ** - Le service utilise uniquement les fichiers 2026

## 📈 Compte de Résultat (Income Statement)

### Fichiers actifs (utilisés)

1. **`default-pcg-config-complete-2026.ts`** ✅
   - Format : Nouveau (structure nested avec `children`)
   - Variante : `complete`
   - Utilisé par : `create-default-pcg-config.service.ts`
   - Structure : Hiérarchique avec `parentId` (pas de `linePath`)

2. **`default-pcg-config-simplified-2026.ts`** ✅
   - Format : Ancien (avec `linePath`) - converti en `parentId` par le service
   - Variante : `simplified`
   - Utilisé par : `create-default-pcg-config.service.ts` pour la variante `simplified`
   - **Note** : Utilise encore l'ancien format `linePath` mais avec le suffixe `-2026` pour cohérence

## 🔍 Où trouver les fichiers

### Bilan
```
lib/reports/balance-sheet/config/
├── default-pcg-config-complete-2026.ts      ✅ Utilisé (complete)
└── default-pcg-config-simplified-2026.ts    ✅ Utilisé (simplified)
```

### Compte de Résultat
```
lib/reports/income-statement/config/
├── default-pcg-config-complete-2026.ts      ✅ Utilisé (complete)
└── default-pcg-config-simplified-2026.ts    ✅ Utilisé (simplified)
```

## 🔧 Service de création

Les services `create-default-pcg-config.service.ts` déterminent quel fichier utiliser :

- **Bilan** : Utilise toujours les fichiers `-2026.ts` (nouveau format)
- **Compte de Résultat** :
  - `complete` → `default-pcg-config-complete-2026.ts` (nouveau format)
  - `simplified` → `default-pcg-config-simplified-2026.ts` (ancien format avec `linePath`, converti en `parentId`)

## 📝 Différences entre les formats

### Ancien format (avec `linePath`)
```typescript
{
  linePath: 'actif.immobilise.incorporelles.fondsCommercial',
  lineLabel: 'Fonds commercial',
  accountCodes: ['207'],
  // ...
}
```
- Utilise `linePath` pour définir la hiérarchie
- Converti en structure `parentId` par le service

### Nouveau format (avec `children`)
```typescript
{
  lineLabel: 'Immobilisations incorporelles',
  accountCodes: [],
  children: [
    {
      lineLabel: 'Fonds commercial',
      accountCodes: ['207'],
      // ...
    }
  ]
}
```
- Structure hiérarchique explicite avec `children`
- Plus lisible et maintenable
- Utilise directement `parentId` en base de données

## 🚨 Problème de doublon

Si vous voyez des doublons dans le bilan, cela peut venir de :
1. **Configuration en base de données** : Plusieurs configurations créées (vérifier via l'éditeur de configuration)
2. **Fichiers de configuration** : Les fichiers ne sont pas la cause directe (ils servent uniquement à créer la config initiale)

## ✅ Actions recommandées

1. ✅ **Supprimé** `lib/reports/balance-sheet/config/default-pcg-configs.ts` (obsolète)
2. ✅ **Créé** `lib/reports/income-statement/config/default-pcg-config-simplified-2026.ts` pour uniformiser le format
3. ✅ **Supprimé** `lib/reports/income-statement/config/default-pcg-configs.ts` (obsolète)
4. **Vérifier** les configurations en base de données pour identifier les doublons
