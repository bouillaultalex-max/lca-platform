/**
 * Données de départ pour un environnement de développement local.
 * Crée le site par défaut et un utilisateur RESPONSABLE_LABORATOIRE si absents.
 * Idempotent : peut être relancé sans dupliquer les données (upsert).
 *
 * ATTENTION : le mot de passe par défaut ci-dessous est destiné au développement
 * uniquement. Il doit être changé avant toute utilisation réelle en production.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../generated/prisma/client';

const DEFAULT_SITE_NAME = 'Laboratoire LCA Distribution';
const DEFAULT_ADMIN_EMAIL = 'responsable@lca-mes.local';
const DEFAULT_ADMIN_PASSWORD = 'ChangezMoi123!';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant : copier .env.example vers .env avant de lancer le seed.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  try {
    const site = (await prisma.site.findFirst()) ?? (await prisma.site.create({ data: { name: DEFAULT_SITE_NAME } }));

    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);

    const admin = await prisma.user.upsert({
      where: { email: DEFAULT_ADMIN_EMAIL },
      update: {},
      create: {
        siteId: site.id,
        fullName: 'Responsable Laboratoire',
        email: DEFAULT_ADMIN_EMAIL,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    console.log('Site prêt :', site.name);
    console.log('Utilisateur prêt :', admin.email, `(mot de passe par défaut : ${DEFAULT_ADMIN_PASSWORD})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec du seed :', error);
  process.exitCode = 1;
});
