// Résultat sérialisable renvoyé par toutes les Server Actions.
//
// Le transport RPC de Next ne peut transporter que des valeurs sérialisables :
// on n'expose donc jamais d'exception, d'ObjectId ni de Decimal128 au client.
// Les wrappers de src/lib/api.ts retraduisent un échec en ApiError afin de
// conserver les messages et les `catch` existants des composants.

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; errors: string[] };
