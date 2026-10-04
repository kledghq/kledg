#!/usr/bin/env node

/**
 * Script pour générer une clé de chiffrement pour Qonto
 * Usage: node scripts/generate-encryption-key.js
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Générer une clé de 64 caractères (32 bytes en hex)
const encryptionKey = crypto.randomBytes(32).toString('hex')

console.log('\n🔐 Clé de chiffrement générée :\n')
console.log(encryptionKey)
console.log('\n📝 Ajoutez cette ligne à votre fichier .env.local ou .env :\n')
console.log(`ENCRYPTION_KEY=${encryptionKey}\n`)

// Vérifier si .env.local existe
const envLocalPath = path.join(process.cwd(), '.env.local')
const envPath = path.join(process.cwd(), '.env')

let envFile = null
if (fs.existsSync(envLocalPath)) {
  envFile = envLocalPath
  console.log('✅ Fichier .env.local trouvé')
} else if (fs.existsSync(envPath)) {
  envFile = envPath
  console.log('✅ Fichier .env trouvé')
} else {
  console.log('⚠️  Aucun fichier .env trouvé. Créez .env.local et ajoutez la clé manuellement.')
  process.exit(0)
}

// Lire le fichier
const envContent = fs.readFileSync(envFile, 'utf8')

// Vérifier si ENCRYPTION_KEY existe déjà
if (envContent.includes('ENCRYPTION_KEY=')) {
  console.log('\n⚠️  ENCRYPTION_KEY existe déjà dans le fichier.')
  console.log('   Remplacez la valeur existante par la nouvelle clé ci-dessus.\n')
} else {
  // Ajouter la clé au fichier
  const newLine = `ENCRYPTION_KEY=${encryptionKey}\n`
  fs.appendFileSync(envFile, newLine)
  console.log(`\n✅ Clé ajoutée automatiquement à ${envFile}\n`)
  console.log('🔄 Redémarrez votre serveur de développement pour appliquer les changements.\n')
}
