import Firebird from "node-firebird";

/**
 * Acesso ao banco Firebird do ERP (rede local). Regra permanente: este banco Ã©
 * SOMENTE LEITURA â€” nunca rodar UPDATE/DELETE/INSERT ou DDL a partir deste app.
 * queryFirebird() recusa qualquer comando que nÃ£o comece com SELECT/WITH.
 */

function options(): Firebird.Options {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`VariÃ¡vel de ambiente ${name} nÃ£o definida`);
    return v;
  };
  return {
    host: required("FIREBIRD_HOST"),
    port: Number(process.env.FIREBIRD_PORT ?? 3050),
    database: required("FIREBIRD_DATABASE"),
    user: required("FIREBIRD_USER"),
    password: required("FIREBIRD_PASSWORD"),
    lowercase_keys: false,
    encoding: (process.env.FIREBIRD_CHARSET ?? "ISO8859_1") as Firebird.SupportedCharacterSet,
  };
}

function assertReadOnly(sql: string) {
  const semStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  const semComentarios = semStrings
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
  if (!/^(select|with)\b/i.test(semComentarios)) {
    throw new Error(
      "Bloqueado: apenas consultas SELECT sÃ£o permitidas no banco Firebird do ERP (regra permanente de somente leitura)."
    );
  }
}

export function queryFirebird<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  assertReadOnly(sql);
  return new Promise((resolve, reject) => {
    Firebird.attach(options(), (errAttach, db) => {
      if (errAttach) { reject(errAttach); return; }
      db.query(sql, params, (errQuery, result) => {
        db.detach();
        if (errQuery) { reject(errQuery); return; }
        resolve(result as T[]);
      });
    });
  });
}
