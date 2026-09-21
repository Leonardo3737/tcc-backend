'use strict';

/**
 * Especializacao 1:1 de USUARIO. Mesmo padrao de `alunos` (PK = FK).
 *
 * `identificacao_funcional` (SIAPE) e opcional porque nem toda instituicao
 * expoe esse dado, mas UNICA quando informada. Em PostgreSQL, varios NULLs nao
 * colidem em uma constraint UNIQUE, entao professores sem SIAPE convivem sem
 * necessidade de indice parcial.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('professores', {
      usuario_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      identificacao_funcional: {
        type: Sequelize.STRING(30),
        allowNull: true,
        unique: true,
      },
      departamento: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('professores');
  },
};
