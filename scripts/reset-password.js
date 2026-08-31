/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function resetPassword() {
  const email = 'brainqurious@gmail.com';
  const newPassword = 'necessaRy@20183*';
  
  console.log(`Looking for user ${email}...`);
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    console.error('User not found!');
    process.exit(1);
  }

  console.log('Hashing new password...');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  
  console.log('Updating database...');
  await prisma.user.update({
    where: { email },
    data: { passwordHash }
  });
  
  console.log('Password successfully reset.');
}

resetPassword()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
