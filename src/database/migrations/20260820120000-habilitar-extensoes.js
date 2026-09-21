'use strict';

/**
 * Extensoes do PostgreSQL usadas pelo schema.
 *
 * - pgcrypto: fornece gen_random_uuid(), usado como DEFAULT das chaves primarias.
 *   Assim linhas criadas fora da aplicacao (seeders, SQL manual, carga inicial)
 *   tambem recebem UUID valido, sem depender do Sequelize.
 * - citext: tipo de texto case-insensitive, usado em usuarios.email. Faz com que
 *   "Joao@ufx.br" e "joao@ufx.br" colidam na constraint UNIQUE — a unicidade do
 *   e-mail deixa de depender de lembrarmos de normalizar em cada ponto do codigo.
 *
 * A extensao btree_gist, necessaria para as constraints EXCLUDE que garantem a
 * RN03 (conflito de horarios), sera habilitada na fase 2, junto da tabela de
 * atendimentos que a utiliza.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS citext;');
  },

  async down(queryInterface) {
    // Nao removemos as extensoes: outros objetos do banco podem depender delas,
    // e um DROP EXTENSION em cascata destruiria colunas.
    await queryInterface.sequelize.query('SELECT 1;');
  },
};
