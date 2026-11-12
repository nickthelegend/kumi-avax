import { ensureKeys, account, ROLES } from './env.ts';
ensureKeys();
for (const role of ROLES) console.log(role.replace(/_KEY$/, ''), account(role).address);
