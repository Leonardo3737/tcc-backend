/**
 * ARQUIVO existe no schema e no CHECK do banco, mas nenhum endpoint o produz
 * nesta versao: material e LINK. Deixar o valor previsto evita uma migration de
 * alteracao quando o upload for implementado.
 */
export enum TipoMaterial {
  LINK = 'LINK',
  ARQUIVO = 'ARQUIVO',
}
