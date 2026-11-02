// Seed mínimo (B1-04): configuración de la iglesia y un usuario por rol. Idempotente (upsert).
// B2 extiende este archivo con datos de dominio (B2-12).
import { ROLES } from '../src/config/permisos';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/seguridad';
import { seedB2 } from './seed-b2';
import { seedDonaciones } from './seed-b4';
import { seedB3 } from './seed-b3';

const NOMBRES: Record<(typeof ROLES)[number], string> = {
  ADMIN: 'Administrador General',
  PASTOR: 'Pastor General',
  SECRETARIO: 'Secretaría',
  TESORERO: 'Tesorería',
  COORDINADOR: 'Coordinador de Ministerio',
};

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('Falta SEED_PASSWORD en backend/.env (ver .env.example).');

  await prisma.configuracionIglesia.upsert({
    where: { id: 1 },
    create: { id: 1, nombre: 'Mi Iglesia' },
    update: {},
  });

  const passwordHash = await hashPassword(password);
  for (const rol of ROLES) {
    const email = `${rol.toLowerCase()}@iglesia.local`;
    // update vacío: volver a correr el seed no cambia contraseñas ni datos editados
    await prisma.usuario.upsert({
      where: { email },
      create: { email, nombre: NOMBRES[rol], rol, passwordHash },
      update: {},
    });
  }

  // B2-12: miembros, ministerios, vínculos y coordinadores
  const { miembroIds, ministerios } = await seedB2();
  // B4: aportaciones de los últimos 12 meses
  const donaciones = await seedDonaciones(miembroIds);

  // B3: eventos (con asistencia), anuncios y un evento cancelado para la demo
  const b3 = await seedB3({ ministerios });

  console.warn(
    `Seed listo: configuración, ${ROLES.length} usuarios (<rol>@iglesia.local), ${miembroIds.length} miembros, ${ministerios.size} ministerios, ${donaciones} aportaciones, ${b3.eventos} eventos, ${b3.asistencias} asistencias y ${b3.anuncios} anuncios.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
