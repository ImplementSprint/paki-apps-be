const { sequelize } = require('./config/db'); sequelize.query('SELECT id, email, "supabaseId" FROM public.users').then(r => console.log(r[0])).catch(console.error).finally(() => process.exit(0));
