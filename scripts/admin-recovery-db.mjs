import pg from "pg";

const { Pool } = pg;

function transactionClient(client) {
  return {
    user: {
      async findUnique({ where }) {
        const result = await client.query('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', [where.id]);
        return result.rows[0] ?? null;
      },
      async update({ where, data }) {
        const columns = {
          passwordHash: "passwordHash",
          totpEnabledAt: "totpEnabledAt",
          totpSecretEncrypted: "totpSecretEncrypted",
          totpPendingSecretEncrypted: "totpPendingSecretEncrypted",
          totpPendingCreatedAt: "totpPendingCreatedAt",
          mustChangePassword: "mustChangePassword",
        };
        const entries = Object.entries(data);
        if (!entries.length) return;
        const assignments = entries.map(([key], index) => {
          const column = columns[key];
          if (!column) throw new Error("Недопустимое поле восстановления");
          return `"${column}" = $${index + 2}`;
        });
        await client.query(
          `UPDATE "User" SET ${assignments.join(", ")}, "updatedAt" = NOW() WHERE "id" = $1`,
          [where.id, ...entries.map(([, value]) => value)],
        );
      },
    },
    session: { deleteMany: ({ where }) => client.query('DELETE FROM "Session" WHERE "userId" = $1', [where.userId]) },
    authChallenge: { deleteMany: ({ where }) => client.query('DELETE FROM "AuthChallenge" WHERE "userId" = $1', [where.userId]) },
    totpRecoveryCode: { deleteMany: ({ where }) => client.query('DELETE FROM "TotpRecoveryCode" WHERE "userId" = $1', [where.userId]) },
  };
}

export function createRecoveryDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 2 });
  return {
    user: {
      async findMany() {
        const result = await pool.query(
          'SELECT "id", "name", "email", "totpEnabledAt" FROM "User" WHERE "role" = \'ADMIN\' ORDER BY "createdAt" ASC',
        );
        return result.rows;
      },
    },
    async $transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(transactionClient(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    $disconnect() {
      return pool.end();
    },
  };
}
