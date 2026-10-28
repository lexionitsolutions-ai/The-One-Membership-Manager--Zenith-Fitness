async function createUser(zk, user) {
  if(process.env.LEGACY_SHEETS_MODE!=='1')throw new Error('Manual legacy device creation is retired. Supabase assigns member IDs.');
  return await zk.setUser(
    Number(user.uid),
    String(user.userId),
    String(user.name),
    '',
    0,
    0
  );
}

module.exports = { createUser };
