export function buildBusinessUserScope({
  userAlias
}: {
  userAlias: string;
}): { joinSql: string; whereParts: string[]; params: number[] } {
  return {
    joinSql: "",
    whereParts: [`${userAlias}.new_api_role < ?`],
    params: [100]
  };
}
