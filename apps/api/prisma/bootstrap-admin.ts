/**
 * Amorçage du tout premier administrateur système (Jalon 2.5).
 *
 * Problème résolu : la gestion des utilisateurs (écran Administration) exige déjà un
 * administrateur système pour être utilisée — ce script crée ce tout premier compte
 * une seule fois, hors de toute interface. Les comptes suivants (Kevin Prian,
 * Jean-Paul Gouveia...) sont créés ensuite par cet administrateur via l'écran
 * Administration > Utilisateurs, pas par ce script.
 *
 * Distinct de `seed.ts` (données de démonstration pour le développement local) :
 * ce script est destiné à un usage réel, y compris en environnement de production.
 * Idempotent : si un compte existe déjà avec l'email cible, ne fait rien.
 *
 * Utilisation : npx tsx prisma/bootstrap-admin.ts
 * Variables d'environnement optionnelles : ADMIN_EMAIL, ADMIN_FULL_NAME, ADMIN_JOB_TITLE.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';

const DEFAULT_SITE_NAME = 'Laboratoire LCA Distribution';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'alexandre.bouillault@lca-mes.local';
const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME ?? 'Alexandre Bouillault';
const ADMIN_JOB_TITLE = process.env.ADMIN_JOB_TITLE ?? 'Responsable adjoint';

function generateTemporaryPassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant : copier .env.example vers .env avant de lancer ce script.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  try {
    const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (existing) {
      console.log(`Un compte existe déjà pour ${ADMIN_EMAIL} — aucune action effectuée.`);
      return;
    }

    const site =
      (await prisma.site.findFirst()) ?? (await prisma.site.create({ data: { name: DEFAULT_SITE_NAME } }));

    const jobTitle =
      (await prisma.jobTitle.findFirst({ where: { siteId: site.id, name: ADMIN_JOB_TITLE } })) ??
      (await prisma.jobTitle.create({ data: { siteId: site.id, name: ADMIN_JOB_TITLE } }));

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    const admin = await prisma.user.create({
      data: {
        siteId: site.id,
        fullName: ADMIN_FULL_NAME,
        email: ADMIN_EMAIL,
        passwordHash,
        role: UserRole.RESPONSABLE_ADJOINT,
        jobTitleId: jobTitle.id,
        isSystemAdmin: true,
        mustChangePassword: true,
      },
    });

    console.log('Administrateur système créé avec succès :');
    console.log(`  Nom complet      : ${admin.fullName}`);
    console.log(`  E-mail           : ${admin.email}`);
    console.log(`  Mot de passe temporaire (à noter, ne sera plus affiché) : ${temporaryPassword}`);
    console.log('  Le changement de mot de passe sera exigé à la première connexion.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Échec de l'amorçage de l'administrateur :", error);
  process.exitCode = 1;
});
